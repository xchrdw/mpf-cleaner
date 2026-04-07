document.addEventListener('DOMContentLoaded', async () => {
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
    let scannedFileCount = 0;
    let totalFilesToScan = 0;

    // Check if the API is supported
    if (!window.showDirectoryPicker) {
        statusText.innerHTML = '<span style="color: #ef4444">Error: Your browser does not support the File System Access API. Please use a modern version of Chrome, Edge, or Opera.</span>';
        selectDirBtn.disabled = true;
        return;
    }

    // DB Helpers for persistent folder handles
    const dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open('mpf-store', 1);
        req.onupgradeneeded = e => e.target.result.createObjectStore('handles');
        req.onsuccess = e => resolve(e.target.result);
        req.onerror = () => reject(req.error);
    });

    async function saveHandle(handle) {
        const db = await dbPromise;
        return new Promise((resolve, reject) => {
            const tx = db.transaction('handles', 'readwrite');
            tx.objectStore('handles').put(handle, 'lastDir');
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
    }

    async function loadHandle() {
        const db = await dbPromise;
        return new Promise((resolve, reject) => {
            const tx = db.transaction('handles', 'readonly');
            const req = tx.objectStore('handles').get('lastDir');
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null); // safely fail
        });
    }

    // Attempt to restore previous folder automatically
    try {
        const lastHandle = await loadHandle();
        if (lastHandle) {
            directoryHandle = lastHandle;
            const permission = await lastHandle.queryPermission({ mode: 'readwrite' });

            if (permission === 'granted') {
                scanDirectory(directoryHandle);
            } else {
                try {
                    // This will almost certainly throw a "must handle user gesture" DOMException,
                    // but we try it anyway in case the browser allows it.
                    if (await lastHandle.requestPermission({ mode: 'readwrite' }) === 'granted') {
                        scanDirectory(directoryHandle);
                    }
                } catch (err) {
                    // Fallback to a text link since we cannot prompt without a user gesture.
                    statusText.innerHTML = `Found previous folder <b id="resumeName"></b>. <a href="#" id="resumeLink" style="color:#6366f1;text-decoration:underline;cursor:pointer;">Click here to resume</a>.`;
                    document.getElementById('resumeName').textContent = lastHandle.name;
                    document.getElementById('resumeLink').addEventListener('click', async (e) => {
                        e.preventDefault();
                        if (await lastHandle.requestPermission({ mode: 'readwrite' }) === 'granted') {
                            scanDirectory(directoryHandle);
                        }
                    });
                }
            }
        }
    } catch (e) {
        console.error("Could not load previous folder", e);
    }

    selectDirBtn.addEventListener('click', async () => {
        try {
            directoryHandle = await window.showDirectoryPicker({
                mode: 'readwrite'
            });
            await saveHandle(directoryHandle);
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
        statusText.innerText = 'Counting total files...';
        totalFilesToScan = await countFilesInDirectory(dirHandle);
        statusText.innerText = 'Scanning directory...';
        foundJpgs = [];
        filesWithMpf = [];
        scannedFileCount = 0;
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

    async function countFilesInDirectory(dirHandle) {
        let count = 0;
        for await (const entry of dirHandle.values()) {
            if (entry.kind === 'file') {
                count++;
            } else if (entry.kind === 'directory') {
                count += await countFilesInDirectory(entry);
            }
        }
        return count;
    }

    async function walkDirectory(dirHandle, path) {
        for await (const entry of dirHandle.values()) {
            if (entry.kind === 'file') {
                scannedFileCount++;
                statusText.innerText = `Scanning directory... (${scannedFileCount}/${totalFilesToScan} files checked)`;
                if (totalFilesToScan > 0) {
                    progressBar.style.width = `${(scannedFileCount / totalFilesToScan) * 100}%`;
                }


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

            let mpfData = detectMPF(buffer, false);
            if (mpfData.hasMpf) {
                filesWithMpf.push({
                    handle: fileHandle,
                    name: path + file.name,
                    originalSize: buffer.byteLength
                });

                const li = document.createElement('li');
                li.id = 'file-' + Array.from(new TextEncoder().encode(path + file.name)).map(b => b.toString(16)).join('');

                const nameSpan = document.createElement('span');
                nameSpan.className = 'file-name';
                nameSpan.textContent = path + file.name;

                const badgeSpan = document.createElement('span');
                badgeSpan.className = 'file-badge';
                badgeSpan.textContent = 'Has MPF';

                li.appendChild(nameSpan);
                li.appendChild(badgeSpan);
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
            const domId = 'file-' + Array.from(new TextEncoder().encode(fileItem.name)).map(b => b.toString(16)).join('');
            try {
                const file = await fileItem.handle.getFile();
                const buffer = await file.arrayBuffer();
                const cleanData = detectMPF(buffer, true);

                if (cleanData.hasMpf && cleanData.data) {
                    const writable = await fileItem.handle.createWritable();
                    await writable.write(cleanData.data);
                    await writable.close();
                } else {
                    throw new Error("File changed or no MPF data found during cleanup.");
                }

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
            statusText.innerText = `Cleaning files... (${i + 1}/${filesToProcess.length} completed)`;
        }

        statusText.innerText = `Finished cleaning ${filesToProcess.length} files.`;
        selectDirBtn.disabled = false;
        filesWithMpf = [];
    }

    /**
     * Parses a JPEG ArrayBuffer, detects MPF data, and immediately returns a new clean buffer
     * if MPF or extra trailer data is present.
     */
    function detectMPF(buffer, returnCleaned = false) {
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

            if (offset + 2 > buffer.byteLength) break;
            let marker = view.getUint16(offset);

            if (marker === 0xFFDA) { // SOS (Start of Scan)
                if (offset + 4 > buffer.byteLength) break;
                let sosLen = view.getUint16(offset + 2);
                offset += 2 + sosLen;

                // Fast forward scanning for EOI (FF D9) marker in the stream.
                while (offset < buffer.byteLength - 1) {
                    // Valid EOI in stream is FF D9 since image data escapes FF as FF 00.
                    if (bytes[offset] === 0xFF && bytes[offset + 1] === 0xD9) {
                        offset += 2; // Include EOI
                        break;
                    }
                    offset++;
                }

                chunks.push(bytes.subarray(currentChunkStart, offset));

                if (offset < buffer.byteLength) {
                    modified = true; // Dropping the trailer which includes the MPF extra files
                    if (!returnCleaned) return { hasMpf: true };
                }
                break; // We're done with the primary image!

            } else {
                let hasLengthMarker = (
                    (marker >= 0xFFE0 && marker <= 0xFFFE) || // APPn, COM
                    (marker >= 0xFFC0 && marker <= 0xFFCF && marker !== 0xFFC8) || // SOFn
                    marker === 0xFFDB || marker === 0xFFC4 || marker === 0xFFCC || marker === 0xFFDD
                );

                if (hasLengthMarker) {
                    if (offset + 4 > buffer.byteLength) break;
                    let len = view.getUint16(offset + 2);

                    // Check if it is APP2 MPF block
                    if (marker === 0xFFE2 && len >= 6) {
                        if (bytes[offset + 4] === 0x4D && bytes[offset + 5] === 0x50 &&
                            bytes[offset + 6] === 0x46 && bytes[offset + 7] === 0x00) {

                            modified = true;
                            if (!returnCleaned) return { hasMpf: true };
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

