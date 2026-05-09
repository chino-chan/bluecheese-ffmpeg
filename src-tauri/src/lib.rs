use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::{BufReader, Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
};
use tauri::{AppHandle, Emitter, Manager, Window};
use tauri_plugin_dialog::DialogExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Preset {
    title: String,
    command: String,
    output_pattern: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Settings {
    save_mode: String,
    custom_output_dir: String,
}

#[derive(Debug, Clone, Serialize)]
struct AppData {
    presets: Vec<Preset>,
    settings: Settings,
}

#[derive(Debug, Clone, Deserialize)]
struct RunRequest {
    input_path: String,
    command_template: String,
    output_pattern: String,
    save_mode: String,
    custom_output_dir: String,
}

#[derive(Debug, Clone, Serialize)]
struct RunResult {
    ok: bool,
    exit_code: i32,
    command: String,
}

fn default_preset() -> Preset {
    Preset {
        title: "Remove audio".to_string(),
        command: "ffmpeg -i \"{input}\" -c copy -an \"{output}\"".to_string(),
        output_pattern: "{name}_no_audio{ext}".to_string(),
    }
}

fn default_settings() -> Settings {
    Settings {
        save_mode: "original".to_string(),
        custom_output_dir: String::new(),
    }
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if app.package_info().version.to_string().is_empty() {
        return Err("Could not resolve app package information.".to_string());
    }

    if cfg!(debug_assertions) {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        return manifest_dir
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| "Could not resolve development data directory.".to_string());
    }

    std::env::current_exe()
        .map_err(|error| error.to_string())?
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "Could not resolve executable directory.".to_string())
}

fn presets_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("presets.json"))
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("settings.json"))
}

fn ensure_parent(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn read_presets(app: &AppHandle) -> Vec<Preset> {
    let path = match presets_path(app) {
        Ok(path) => path,
        Err(_) => return vec![default_preset()],
    };

    if !path.exists() {
        let presets = vec![default_preset()];
        let _ = write_presets(app, &presets);
        return presets;
    }

    fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str::<Vec<Preset>>(&content).ok())
        .filter(|presets| !presets.is_empty())
        .unwrap_or_else(|| vec![default_preset()])
}

fn write_presets(app: &AppHandle, presets: &[Preset]) -> Result<(), String> {
    let path = presets_path(app)?;
    ensure_parent(&path)?;
    let content = serde_json::to_string_pretty(presets).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())
}

fn read_settings(app: &AppHandle) -> Settings {
    let path = match settings_path(app) {
        Ok(path) => path,
        Err(_) => return default_settings(),
    };

    fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str::<Settings>(&content).ok())
        .unwrap_or_else(default_settings)
}

fn write_settings(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app)?;
    ensure_parent(&path)?;
    let content = serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())
}

#[tauri::command]
fn load_app_data(app: AppHandle) -> AppData {
    AppData {
        presets: read_presets(&app),
        settings: read_settings(&app),
    }
}

#[tauri::command]
fn save_presets(app: AppHandle, presets: Vec<Preset>) -> Result<(), String> {
    write_presets(&app, &presets)
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    write_settings(&app, &settings)
}

#[tauri::command]
fn choose_input_file(app: AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .blocking_pick_file()
        .map(|path| path.to_string())
}

#[tauri::command]
fn choose_output_folder(app: AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .blocking_pick_folder()
        .map(|path| path.to_string())
}

fn split_name_ext(path: &Path) -> (String, String) {
    let name = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("output")
        .to_string();
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{value}"))
        .unwrap_or_default();
    (name, ext)
}

fn replace_placeholders(template: &str, values: &HashMap<&str, String>) -> String {
    values.iter().fold(template.to_string(), |result, (key, value)| {
        result.replace(&format!("{{{key}}}"), value)
    })
}

fn unique_output_path(path: PathBuf) -> PathBuf {
    if !path.exists() {
        return path;
    }

    let parent = path.parent().map(Path::to_path_buf).unwrap_or_default();
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("output");
    let extension = path.extension().and_then(|value| value.to_str());

    for index in 1..10_000 {
        let file_name = match extension {
            Some(extension) if !extension.is_empty() => format!("{stem}({index}).{extension}"),
            _ => format!("{stem}({index})"),
        };
        let candidate = parent.join(file_name);
        if !candidate.exists() {
            return candidate;
        }
    }

    path
}

fn build_command(request: &RunRequest) -> Result<String, String> {
    let input_path = PathBuf::from(&request.input_path);
    if !input_path.exists() {
        return Err("The selected input file does not exist.".to_string());
    }

    if !request.command_template.contains("{input}") {
        return Err("The command template must include {input}.".to_string());
    }

    let folder = input_path
        .parent()
        .ok_or_else(|| "Could not resolve input folder.".to_string())?;
    let (name, ext) = split_name_ext(&input_path);
    let output_dir = if request.save_mode == "custom" {
        if request.custom_output_dir.trim().is_empty() {
            return Err("Choose a custom output folder or save to the original folder.".to_string());
        }
        PathBuf::from(request.custom_output_dir.trim())
    } else {
        folder.to_path_buf()
    };

    let mut values = HashMap::new();
    values.insert("input", input_path.to_string_lossy().to_string());
    values.insert("name", name);
    values.insert("ext", ext);
    values.insert("folder", folder.to_string_lossy().to_string());
    values.insert("output_dir", output_dir.to_string_lossy().to_string());

    let output_name = replace_placeholders(
        if request.output_pattern.trim().is_empty() {
            "{name}_converted{ext}"
        } else {
            request.output_pattern.trim()
        },
        &values,
    );
    let output = unique_output_path(output_dir.join(output_name));
    values.insert("output", output.to_string_lossy().to_string());

    Ok(replace_placeholders(&request.command_template, &values))
}

fn split_command(command: &str) -> Result<Vec<String>, String> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;

    for character in command.chars() {
        if matches!(character, '"' | '\'') {
            if quote == Some(character) {
                quote = None;
                continue;
            }
            if quote.is_none() {
                quote = Some(character);
                continue;
            }
        }

        if character.is_whitespace() && quote.is_none() {
            if !current.is_empty() {
                args.push(current.clone());
                current.clear();
            }
            continue;
        }

        current.push(character);
    }

    if quote.is_some() {
        return Err("Command contains an unclosed quote.".to_string());
    }
    if !current.is_empty() {
        args.push(current);
    }
    if args.is_empty() {
        return Err("Could not parse command.".to_string());
    }
    Ok(args)
}

fn ffmpeg_path(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let resource_path = resource_dir.join("ffmpeg").join("ffmpeg.exe");
        if resource_path.exists() {
            return Some(resource_path);
        }

        let flat_resource_path = resource_dir.join("ffmpeg.exe");
        if flat_resource_path.exists() {
            return Some(flat_resource_path);
        }
    }

    if cfg!(debug_assertions) {
        let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join("ffmpeg")
            .join("ffmpeg.exe");
        if dev_path.exists() {
            return Some(dev_path);
        }
    }

    None
}

fn has_overwrite_policy(args: &[String]) -> bool {
    args.iter().any(|arg| matches!(arg.as_str(), "-y" | "-n"))
}

fn emit_reader(window: Window, reader: impl Read + Send + 'static) {
    thread::spawn(move || {
        let mut reader = BufReader::new(reader);
        let mut buffer = [0_u8; 1024];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => {
                    let text = String::from_utf8_lossy(&buffer[..count]).to_string();
                    let _ = window.emit("ffmpeg-log", text);
                }
                Err(error) => {
                    let _ = window.emit("ffmpeg-log", format!("\nRead error: {error}\n"));
                    break;
                }
            }
        }
    });
}

#[tauri::command]
fn run_ffmpeg(app: AppHandle, window: Window, request: RunRequest) -> Result<RunResult, String> {
    let command = build_command(&request)?;
    let _ = window.emit("ffmpeg-log", format!("> {command}\n\n"));
    let mut args = split_command(&command)?;

    let mut program = args.remove(0);
    if matches!(program.to_ascii_lowercase().as_str(), "ffmpeg" | "ffmpeg.exe") {
        if let Some(path) = ffmpeg_path(&app) {
            program = path.to_string_lossy().to_string();
        }
    }

    if !has_overwrite_policy(&args) {
        args.insert(0, "-n".to_string());
    }

    let mut child = Command::new(&program)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags_windows()
        .spawn()
        .map_err(|error| format!("Could not start FFmpeg: {error}"))?;

    if let Some(stdout) = child.stdout.take() {
        emit_reader(window.clone(), stdout);
    }
    if let Some(stderr) = child.stderr.take() {
        emit_reader(window.clone(), stderr);
    }

    let status = child.wait().map_err(|error| error.to_string())?;
    let exit_code = status.code().unwrap_or(-1);

    Ok(RunResult {
        ok: status.success(),
        exit_code,
        command,
    })
}

trait WindowsNoConsole {
    fn creation_flags_windows(&mut self) -> &mut Self;
}

impl WindowsNoConsole for Command {
    fn creation_flags_windows(&mut self) -> &mut Self {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            self.creation_flags(0x08000000);
        }
        self
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            load_app_data,
            save_presets,
            save_settings,
            choose_input_file,
            choose_output_folder,
            run_ffmpeg
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::unique_output_path;
    use std::{fs, path::PathBuf, time::{SystemTime, UNIX_EPOCH}};

    fn temp_test_dir() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("bluecheese-test-{unique}"))
    }

    #[test]
    fn unique_output_path_appends_index_when_file_exists() {
        let dir = temp_test_dir();
        fs::create_dir_all(&dir).unwrap();
        let original = dir.join("video_converted.mp4");
        fs::write(&original, b"existing").unwrap();

        let unique = unique_output_path(original);

        assert_eq!(unique.file_name().unwrap(), "video_converted(1).mp4");
        fs::remove_dir_all(dir).unwrap();
    }
}
