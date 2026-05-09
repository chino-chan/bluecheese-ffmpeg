# BlueCheese FFmpeg

Tired of having to open CMD and copypaste the same FFmpeg commands you always use?

You would like a GUI but want to keep the flexibility of commandline?.

Ok, here you can save predetermined FFmpeg command presets, then never edit them again. Just by using templates it will replace the filenames directly. You can now drag and drop and pick the command preset you want to use. Easy life. However, make sure to read the cheat-sheet to format the command presets correctly. 

<img width="653" height="648" alt="image" src="https://github.com/user-attachments/assets/b6d15f3a-1e2b-4ad3-97d0-8c00af3b69bd" />


---


You can also save commands that need to be edited, such as clipping video timestamps, and easily edit them on the go.


<img width="638" height="491" alt="image" src="https://github.com/user-attachments/assets/965d3e32-48e2-4d10-ac20-ac7d53177151" />



## Templates

Template formatting is used for both saved presets & one-time-commands. 
Basically, you need to format the FFmpeg commands you use in a way that they can be dynamically changed later by the program when you drag and drop a new file.

```text
{input}       Full input file path
{output}      Full output file path
{name}        File name without extension
{ext}         Original extension, including dot
{folder}      Original input folder
{output_dir}  Selected output folder
```

Example:

Say you use the remove audio command a lot, then you would save this preset.

```text
ffmpeg -i "{input}" -c copy -an "{output}"
```

Output pattern:

```text
{name}_no_audio{ext}
```
