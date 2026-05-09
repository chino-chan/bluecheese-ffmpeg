# BlueCheese FFmpeg

Are you tired of having to open CMD and copypaste the same FFmpeg commands you always use? Having to edit in the filenames everytime? You would like a GUI but want to keep the flexibility of commandline?.

....

Well, this is made for that in mind. You can save predetermined FFmpeg command presets, then never edit them again, just by using templates it will replace the filenames directly. You can now drag and drop and pick the command preset you want to use. Easy life. 

However, make sure to read the cheat-sheet to format the command preset correctly. 

<img width="638" height="648" alt="image" src="https://github.com/user-attachments/assets/7fecefe4-3f76-40cc-9aba-abd4d339aca2" />


## Templates

Template formatting is used for both saved presets & one-time-commands. 

Don't complain to me! Be grateful I give you the option to use a one-time command!

This is supposed to be a preset GUI!

```text
{input}       Full input file path
{output}      Full output file path
{name}        File name without extension
{ext}         Original extension, including dot
{folder}      Original input folder
{output_dir}  Selected output folder
```

Example:

```text
ffmpeg -i "{input}" -c copy -an "{output}"
```

Output pattern:

```text
{name}_no_audio{ext}
```
