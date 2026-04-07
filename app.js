document.addEventListener('DOMContentLoaded', () => {
    const selectDirBtn = document.getElementById('selectDirBtn');
    const cleanBtn = document.getElementById('cleanBtn');
    const statusText = document.getElementById('statusText');
    const progressContainer = document.getElementById('progressContainer');
    const progressBar = document.getElementById('progressBar');
    const statsRow = document.getElementById('statsRow');
    const totalFilesEl = document.getElementById('totalFiles');
    const mpfFilesEl = document.getElementById('mpfFiles');
    const fileListEl = document.getElementById('fileList');

    let directoryHandle = null;
    let foundJpgs = [];
    let filesWithMpf = [];

    // Check if the API is supported
    if (!window.showDirectoryPicker) {
        statusText.innerHTML = '<span style="color: #ef4444">Error: Your browser does not support the File System Access API. Please use a modern version of Chrome, Edge, or Opera.</span>';
        selectDirBtn.disabled = true;
        return;
    }

    selectDirBtn.addEventListener('click', async () => {
        try {
            directoryHandle = await window.showDirectoryPicker({
                mode: 'readwrite'
            });
            await scanDirectory(directoryHandle);
        } catch (err) {
            if (err.name !== 'AbortError') {
                statusText.innerText = 'Error selecting directory: ' + err.message;
                console.error(err);
            }
        }
    });

    cleanBtn.addEventListener('click', async () => {
        if (filesWithMpf.length === 0) return;
        await processFiles(filesWithMpf);
    });

    async function scanDirectory(dirHandle) {
        statusText.innerText = 'Scanning directory...';
        foundJpgs = [];
        filesWithMpf = [];
        fileListEl.innerHTML = '';
        statsRow.style.display = 'flex';
        cleanBtn.disabled = true;
        progressContainer.style.display = 'block';
        progressBar.style.width = '0%';

        await walkDirectory(dirHandle, '');

        totalFilesEl.innerText = foundJpgs.length;
        mpfFilesEl.innerText = filesWithMpf.length;
        progressContainer.style.display = 'none';

        if (filesWithMpf.length > 0) {
            statusText.innerText = `Scan complete. Found ${filesWithMpf.length} files with MPF data ready to be cleaned.`;
            cleanBtn.disabled = false;
        } else {
            statusText.innerText = `Scan complete. No MPF data found in ${foundJpgs.length} JPEGs.`;
        }
    }

    async function walkDirectory(dirHandle, path) {
        for await (const entry of dirHandle.values()) {
            if (entry.kind === 'file') {
                if (entry.name.toLowerCase().endsWith('.jpg') || entry.name.toLowerCase().endsWith('.jpeg')) {
                    foundJpgs.push(entry);
                    await checkFileForMpf(entry, path);
                }
            } else if (entry.kind === 'directory') {
                // Recursively walk subdirectories
                await walkDirectory(entry, path + entry.name + '/');
            }
        }
    }

    async function checkFileForMpf(fileHandle, path) {
        try {
            const file = await fileHandle.getFile();
            const buffer = await file.arrayBuffer();
            
            let mpfData = detectMPF(buffer);
            if (mpfData.hasMpf) {
                filesWithMpf.push({
                    handle: fileHandle,
                    name: path + file.name,
                    buffer: mpfData.data, // This is the processed buffer ready to be written
                    originalSize: buffer.byteLength,
                    newSize: mpfData.data.byteLength
                });
                
                const li = document.createElement('li');
                li.id = 'file-' + btoa(unescape(encodeURIComponent(fileHandle.name))).replace(/[^a-zA-Z0-9]/g, '');
                li.innerHTML = `
                    <span class="file-name">${path}${file.name}</span>
                    <span class="file-badge">Has MPF</span>
                `;
                fileListEl.appendChild(li);
                
                mpfFilesEl.innerText = filesWithMpf.length;
            }
        } catch (e) {
            console.error("Error reading file", fileHandle.name, e);
        }
    }

    async function processFiles(filesToProcess) {
        statusText.innerText = 'Cleaning MPF data...';
        cleanBtn.disabled = true;
        selectDirBtn.disabled = true;
        progressContainer.style.display = 'block';
        
        for (let i = 0; i < filesToProcess.length; i++) {
            const fileItem = filesToProcess[i];
            const domId = 'file-' + btoa(unescape(encodeURIComponent(fileItem.handle.name))).replace(/[^a-zA-Z0-9]/g, '');
            try {
                const writable = await fileItem.handle.createWritable();
                await writable.write(fileItem.buffer);
                await writable.close();
                
                // Update UI
                const li = document.getElementById(domId);
                if (li) {
                    const badge = li.querySelector('.file-badge');
                    badge.className = 'file-badge success';
                    badge.innerText = 'Cleaned';
                }
            } catch (err) {
                console.error('Failed to write to', fileItem.name, err);
                const li = document.getElementById(domId);
                if (li) {
                    const badge = li.querySelector('.file-badge');
                    badge.style.background = 'rgba(239, 68, 68, 0.2)';
                    badge.style.color = '#ef4444';
                    badge.innerText = 'Error';
                }
            }
            
            progressBar.style.width = `${((i + 1) / filesToProcess.length) * 100}%`;
        }

        statusText.innerText = `Finished cleaning ${filesToProcess.length} files.`;
        selectDirBtn.disabled = false;
        filesWithMpf = [];
    }

    /**
     * Parses a JPEG ArrayBuffer, detects MPF data, and immediately returns a new clean buffer
     * if MPF or extra trailer data is present.
     */
    function detectMPF(buffer) {
        const view = new DataView(buffer);
        const bytes = new Uint8Array(buffer);
        const chunks = [];
        
        if (buffer.byteLength < 4 || view.getUint16(0) !== 0xFFD8) {
             return { hasMpf: false };
        }
        
        let offset = 2;
        let modified = false;
        let currentChunkStart = 0;
        
        while (offset < buffer.byteLength - 1) {
            // Find next marker, skipping padding
            while (offset < buffer.byteLength - 1 && bytes[offset] === 0xFF && bytes[offset + 1] === 0xFF) {
                offset++;
            }
            
            if (bytes[offset] !== 0xFF) {
                // Lost sync, likely corrupted JPEG, stop parsing cleanly.
                break;
            }
            
            let marker = view.getUint16(offset);
            
            if (marker === 0xFFDA) { // SOS (Start of Scan)
                let sosLen = view.getUint16(offset + 2);
                offset += 2 + sosLen;
                
                // Fast forward scanning for EOI (FF D9) marker in the stream.
                while (offset < buffer.byteLength - 1) {
                    // Valid EOI in stream is FF D9 since image data escapes FF as FF 00.
                    if (bytes[offset] === 0xFF && bytes[offset+1] === 0xD9) {
                        offset += 2; // Include EOI
                        break;
                    }
                    offset++;
                }
                
                chunks.push(bytes.subarray(currentChunkStart, offset));
                
                if (offset < buffer.byteLength) {
                    modified = true; // Dropping the trailer which includes the MPF extra files
                }
                break; // We're done with the primary image!
                
            } else {
                let hasLengthMarker = (
                    (marker >= 0xFFE0 && marker <= 0xFFFE) || // APPn, COM
                    (marker >= 0xFFC0 && marker <= 0xFFCF && marker !== 0xFFC8) || // SOFn
                    marker === 0xFFDB || marker === 0xFFC4 || marker === 0xFFCC || marker === 0xFFDD
                );
                
                if (hasLengthMarker) {
                    let len = view.getUint16(offset + 2);
                    
                    // Check if it is APP2 MPF block
                    if (marker === 0xFFE2 && len >= 6) {
                        if (bytes[offset + 4] === 0x4D && bytes[offset + 5] === 0x50 && 
                            bytes[offset + 6] === 0x46 && bytes[offset + 7] === 0x00) {
                            
                            modified = true;
                            // Push everything read so far
                            if (offset > currentChunkStart) {
                                chunks.push(bytes.subarray(currentChunkStart, offset));
                            }
                            // Skip the APP2 block
                            offset += 2 + len;
                            currentChunkStart = offset;
                            continue;
                        }
                    }
                    offset += 2 + len;
                } else {
                    // Standalone marker without length
                    offset += 2;
                }
            }
        }
        
        if (!modified) {
            return { hasMpf: false };
        }
        
        // Assemble cleaned buffer
        let totalLength = 0;
        for (let c of chunks) totalLength += c.length;
        
        let newBytes = new Uint8Array(totalLength);
        let p = 0;
        for (let c of chunks) {
            newBytes.set(c, p);
            p += c.length;
        }
        
        return { hasMpf: true, data: newBytes.buffer };
    }
});

// Register service worker for offline support
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('Service Worker registered with scope:', reg.scope))
            .catch(err => console.error('Service Worker registration failed:', err));
    });
}

