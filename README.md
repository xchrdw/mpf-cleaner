# MPF Data Cleaner

A fast, fully local, in-browser tool to detect and safely remove Multi-Picture Format (MPF) headers and trailers from JPEG files without any quality loss.

## The Problem
Sometimes JPEGs created by certain cameras (or exported from certain software) include Multi-Picture Format data. When uploading these specific files to platforms like Google Photos, it can trigger severe, unintended compression issues because the platform attempts to process the secondary/depth images embedded in the file. 

## The Solution
This tool scans your chosen folders directly in your browser, finds any JPEG files containing MPF data, and strips out the extra data, leaving the original primary image completely untouched and unmodified in quality.

## Features
- **100% Local Processing:** Uses the modern File System Access API. Files never leave your device.
- **Offline Capable & PWA:** Built as a Progressive Web App. Install it to your desktop or mobile device and use it entirely offline.
- **Fast & Safe:** Parses the JPEG structure block by block, ensuring only the exact MPF structures are removed without re-encoding the image.

## Usage
1. Open the application in a modern browser that supports the File System Access API (Chrome, Edge, Opera).
2. Click **Select Folder** and choose the directory containing your JPEG/JPG files.
3. The tool will recursively scan the folder.
4. If MPF data is detected in any files, click the **Clean MPF Data** button to fix them.
5. The original files will be safely overwritten with the cleaned versions.

## Requirements
- A modern browser that supports the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API) (Currently supported in Chrome, Edge, and Opera).
- *Note: Firefox and Safari do not yet fully support the File System Access API required for direct folder manipulation.*

## Development
This is a plain HTML/JS/CSS tool requiring no build steps. 
To run locally, simply serve the directory with any local web server:
```bash
npx serve .
```
