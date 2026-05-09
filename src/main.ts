import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type Preset = {
  title: string;
  command: string;
  output_pattern: string;
};

type Settings = {
  save_mode: "original" | "custom";
  custom_output_dir: string;
};

type AppData = {
  presets: Preset[];
  settings: Settings;
};

type RunRequest = {
  input_path: string;
  command_template: string;
  output_pattern: string;
  save_mode: "original" | "custom";
  custom_output_dir: string;
};

const defaultPreset: Preset = {
  title: "Remove audio",
  command: 'ffmpeg -i "{input}" -c copy -an "{output}"',
  output_pattern: "{name}_no_audio{ext}",
};

const state = {
  presets: [defaultPreset],
  settings: {
    save_mode: "original",
    custom_output_dir: "",
  } as Settings,
  selectedPresetIndex: 0,
  inputPath: "",
  isRunning: false,
  editingPresetIndex: null as number | null,
};

const $ = <T extends HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
};

const elements = {
  dropZone: $("#dropZone"),
  fileLabel: $("#fileLabel"),
  savedMode: $("#savedMode") as HTMLInputElement,
  oneTimeMode: $("#oneTimeMode") as HTMLInputElement,
  presetArea: $("#presetArea"),
  presetList: $("#presetList"),
  addPresetButton: $("#addPresetButton") as HTMLButtonElement,
  editPresetButton: $("#editPresetButton") as HTMLButtonElement,
  deletePresetButton: $("#deletePresetButton") as HTMLButtonElement,
  oneTimeArea: $("#oneTimeArea"),
  oneTimeCommand: $("#oneTimeCommand") as HTMLTextAreaElement,
  oneTimeOutput: $("#oneTimeOutput") as HTMLInputElement,
  originalFolderMode: $("#originalFolderMode") as HTMLInputElement,
  customFolderMode: $("#customFolderMode") as HTMLInputElement,
  customOutputDir: $("#customOutputDir") as HTMLInputElement,
  browseOutputButton: $("#browseOutputButton") as HTMLButtonElement,
  runButton: $("#runButton") as HTMLButtonElement,
  helpButton: $("#helpButton") as HTMLButtonElement,
  statusLabel: $("#statusLabel"),
  presetDialog: $("#presetDialog") as HTMLDialogElement,
  presetDialogTitle: $("#presetDialogTitle"),
  presetTitleInput: $("#presetTitleInput") as HTMLInputElement,
  presetCommandInput: $("#presetCommandInput") as HTMLTextAreaElement,
  presetOutputInput: $("#presetOutputInput") as HTMLInputElement,
  helpDialog: $("#helpDialog") as HTMLDialogElement,
  runDialog: $("#runDialog") as HTMLDialogElement,
  runDialogTitle: $("#runDialogTitle"),
  runDialogStatus: $("#runDialogStatus"),
  closeRunDialogButton: $("#closeRunDialogButton") as HTMLButtonElement,
  logOutput: $("#logOutput"),
};

function basename(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? filePath.slice(index + 1) : filePath;
}

function setStatus(text: string) {
  elements.statusLabel.textContent = text;
}

function setInputPath(filePath: string) {
  state.inputPath = filePath;
  elements.fileLabel.textContent = filePath || "No file selected";
  elements.dropZone.querySelector(".drop-title")!.textContent = filePath
    ? basename(filePath)
    : "Click here, or drop a media file here";
}

function getActiveTemplate(): Preset | null {
  if (elements.savedMode.checked) {
    return state.presets[state.selectedPresetIndex] || null;
  }

  return {
    title: "One-time command",
    command: elements.oneTimeCommand.value.trim(),
    output_pattern: elements.oneTimeOutput.value.trim() || "{name}_converted{ext}",
  };
}

function renderPresets() {
  elements.presetList.innerHTML = "";

  state.presets.forEach((preset, index) => {
    const item = document.createElement("label");
    item.className = `preset-item${index === state.selectedPresetIndex ? " is-selected" : ""}`;

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "preset";
    radio.checked = index === state.selectedPresetIndex;
    radio.addEventListener("change", () => {
      state.selectedPresetIndex = index;
      renderPresets();
      updateUiState();
    });

    const content = document.createElement("div");
    const title = document.createElement("div");
    title.className = "preset-title";
    title.textContent = preset.title;

    const command = document.createElement("div");
    command.className = "preset-command";
    command.textContent = `${preset.command} | ${preset.output_pattern}`;

    content.append(title, command);
    item.append(radio, content);
    elements.presetList.append(item);
  });
}

function updateUiState() {
  const usingSaved = elements.savedMode.checked;
  const usingCustom = elements.customFolderMode.checked;

  elements.presetArea.classList.toggle("is-disabled", !usingSaved);
  elements.presetList.querySelectorAll("input").forEach((input) => {
    (input as HTMLInputElement).disabled = !usingSaved;
  });
  elements.addPresetButton.disabled = !usingSaved;
  elements.editPresetButton.disabled = !usingSaved || !state.presets.length;
  elements.deletePresetButton.disabled = !usingSaved || !state.presets.length;

  elements.oneTimeArea.classList.toggle("is-disabled", usingSaved);
  elements.oneTimeCommand.disabled = usingSaved;
  elements.oneTimeOutput.disabled = usingSaved;

  elements.customOutputDir.disabled = !usingCustom;
  elements.browseOutputButton.disabled = !usingCustom;
  elements.runButton.disabled = state.isRunning;
}

async function savePresets() {
  await invoke("save_presets", { presets: state.presets });
}

async function saveSettings() {
  state.settings = {
    save_mode: elements.customFolderMode.checked ? "custom" : "original",
    custom_output_dir: elements.customOutputDir.value.trim(),
  };
  await invoke("save_settings", { settings: state.settings });
}

function validateRun(): string {
  const active = getActiveTemplate();
  if (!state.inputPath) return "Drop or choose an input file first.";
  if (!active || !active.command) return "Choose a preset or enter a one-time command.";
  if (!active.command.includes("{input}")) return 'The command template must include "{input}".';
  if (elements.customFolderMode.checked && !elements.customOutputDir.value.trim()) {
    return "Choose a custom output folder or save to the original folder.";
  }
  return "";
}

function openPresetDialog(index: number | null = null) {
  state.editingPresetIndex = index;
  const preset = index === null
    ? { title: "", command: "", output_pattern: "{name}_converted{ext}" }
    : state.presets[index];

  elements.presetDialogTitle.textContent = index === null ? "Add preset" : "Edit preset";
  elements.presetTitleInput.value = preset.title;
  elements.presetCommandInput.value = preset.command;
  elements.presetOutputInput.value = preset.output_pattern;
  elements.presetDialog.showModal();
}

async function runFfmpeg() {
  const validationError = validateRun();
  if (validationError) {
    alert(validationError);
    return;
  }

  const active = getActiveTemplate()!;
  const request: RunRequest = {
    input_path: state.inputPath,
    command_template: active.command,
    output_pattern: active.output_pattern,
    save_mode: elements.customFolderMode.checked ? "custom" : "original",
    custom_output_dir: elements.customOutputDir.value.trim(),
  };

  state.isRunning = true;
  updateUiState();
  setStatus("Running...");
  elements.runDialogTitle.textContent = "Running FFmpeg";
  elements.runDialogStatus.textContent = "Running...";
  elements.closeRunDialogButton.disabled = true;
  elements.logOutput.textContent = "";
  elements.runDialog.showModal();
  await saveSettings();

  try {
    const result = await invoke<{ ok: boolean; exit_code: number; command: string }>("run_ffmpeg", { request });
    state.isRunning = false;
    updateUiState();
    elements.closeRunDialogButton.disabled = false;

    if (result.ok) {
      setStatus("Finished");
      elements.runDialogTitle.textContent = "Finished";
      elements.runDialogStatus.textContent = "Done";
      elements.logOutput.textContent += "\nDone.";
    } else {
      setStatus(`Failed (${result.exit_code})`);
      elements.runDialogTitle.textContent = "FFmpeg failed";
      elements.runDialogStatus.textContent = `Exit code ${result.exit_code}`;
      elements.logOutput.textContent += `\nFailed with exit code ${result.exit_code}.`;
    }
  } catch (error) {
    state.isRunning = false;
    updateUiState();
    elements.closeRunDialogButton.disabled = false;
    setStatus("Failed");
    elements.runDialogTitle.textContent = "FFmpeg failed";
    elements.runDialogStatus.textContent = "Error";
    elements.logOutput.textContent += `\n${String(error)}`;
  }
}

function attachEvents() {
  elements.dropZone.addEventListener("click", async () => {
    const filePath = await invoke<string | null>("choose_input_file");
    if (filePath) setInputPath(filePath);
  });

  elements.dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    elements.dropZone.classList.add("is-over");
  });

  elements.dropZone.addEventListener("dragleave", () => {
    elements.dropZone.classList.remove("is-over");
  });

  elements.savedMode.addEventListener("change", updateUiState);
  elements.oneTimeMode.addEventListener("change", updateUiState);
  elements.originalFolderMode.addEventListener("change", () => {
    updateUiState();
    saveSettings();
  });
  elements.customFolderMode.addEventListener("change", () => {
    updateUiState();
    saveSettings();
  });
  elements.customOutputDir.addEventListener("change", saveSettings);

  elements.browseOutputButton.addEventListener("click", async () => {
    const folder = await invoke<string | null>("choose_output_folder");
    if (!folder) return;
    elements.customFolderMode.checked = true;
    elements.customOutputDir.value = folder;
    updateUiState();
    saveSettings();
  });

  elements.addPresetButton.addEventListener("click", () => openPresetDialog());
  elements.editPresetButton.addEventListener("click", () => openPresetDialog(state.selectedPresetIndex));
  elements.deletePresetButton.addEventListener("click", async () => {
    const preset = state.presets[state.selectedPresetIndex];
    if (!preset) return;
    if (!confirm(`Delete "${preset.title}"?`)) return;
    state.presets.splice(state.selectedPresetIndex, 1);
    state.selectedPresetIndex = Math.max(0, state.selectedPresetIndex - 1);
    await savePresets();
    renderPresets();
    updateUiState();
  });

  elements.presetDialog.addEventListener("close", async () => {
    if (elements.presetDialog.returnValue !== "default") return;
    const preset: Preset = {
      title: elements.presetTitleInput.value.trim() || "Untitled preset",
      command: elements.presetCommandInput.value.trim(),
      output_pattern: elements.presetOutputInput.value.trim() || "{name}_converted{ext}",
    };
    if (!preset.command) {
      alert("Enter a command template.");
      return;
    }

    if (state.editingPresetIndex === null) {
      state.presets.push(preset);
      state.selectedPresetIndex = state.presets.length - 1;
    } else {
      state.presets[state.editingPresetIndex] = preset;
    }

    await savePresets();
    renderPresets();
    updateUiState();
  });

  elements.helpButton.addEventListener("click", () => elements.helpDialog.showModal());
  elements.runDialog.addEventListener("cancel", (event) => {
    if (state.isRunning) event.preventDefault();
  });
  elements.runButton.addEventListener("click", () => runFfmpeg());
}

async function init() {
  const data = await invoke<AppData>("load_app_data");
  state.presets = data.presets.length ? data.presets : [defaultPreset];
  state.settings = data.settings;

  if (state.settings.save_mode === "custom") {
    elements.customFolderMode.checked = true;
  }
  elements.customOutputDir.value = state.settings.custom_output_dir || "";

  await listen<string>("tauri://drag-drop", (event) => {
    const paths = event.payload as unknown as { paths?: string[] };
    const first = Array.isArray(paths.paths) ? paths.paths[0] : "";
    if (first) setInputPath(first);
    elements.dropZone.classList.remove("is-over");
  });

  await listen<string>("ffmpeg-log", (event) => {
    elements.logOutput.textContent += event.payload;
    elements.logOutput.scrollTop = elements.logOutput.scrollHeight;
  });

  renderPresets();
  updateUiState();
  attachEvents();
}

window.addEventListener("DOMContentLoaded", () => {
  init().catch((error) => {
    console.error(error);
    alert(String(error));
  });
});
