const fs = require('fs');
const path = require('path');
const ignorePackage = require('ignore');

// Define folder names (atualizado para estrutura Vite)
const SRC_FOLDER_NAME = 'src';
const SUBFOLDERS_AND_FILES = ['js', 'css']; // Pastas dentro de src/
const ROOT_FILES = ['index.html']; // Arquivos na raiz do projeto
const DEST_FOLDER_NAME = 'src_total';

// List of folders to ignore
const FOLDERS_TO_IGNORE = ['.git', 'node_modules', 'vendors', 'images', 'assets', 'vendor'];

// File extensions to process
const EXTENSIONS_TO_PROCESS = ['.js', '.css', '.html'];

function readGitignore(projectRoot) {
    const gitignorePath = path.join(projectRoot, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
        const content = fs.readFileSync(gitignorePath, 'utf8');
        return ignorePackage().add(content.split('\n'));
    }
    return ignorePackage();
}

function shouldIgnore(item, relativePath, ig) {
    // Check if the item is in the list of folders to ignore
    if (FOLDERS_TO_IGNORE.includes(item)) {
        return true;
    }
    // Check if the item should be ignored by .gitignore
    return ig.ignores(relativePath);
}

// Function to check if file has a valid extension
function hasValidExtension(filename) {
    return EXTENSIONS_TO_PROCESS.some(ext => filename.endsWith(ext));
}

// Function to copy and rename files from src to src_total
function copyFilesToDestination(srcDir, destDir, currentDir, ig, pathPrefix = '') {
    const items = fs.readdirSync(currentDir);

    for (const item of items) {
        const fullPath = path.join(currentDir, item);
        const relativePath = path.relative(srcDir, fullPath);

        if (shouldIgnore(item, relativePath, ig)) continue;

        const stats = fs.statSync(fullPath);

        if (stats.isDirectory()) {
            // Recursive call for directories
            const newPrefix = pathPrefix ? `${pathPrefix}_${item}` : item;
            copyFilesToDestination(srcDir, destDir, fullPath, ig, newPrefix);
        } else {
            if (hasValidExtension(item)) {
                // Process files with valid extensions
                const pathParts = relativePath.split(path.sep);
                const newFileName = pathParts.join('_');
                const destPath = path.join(destDir, newFileName);

                // Copy the file with the new name
                fs.copyFileSync(fullPath, destPath);
                console.log(`Copied: ${relativePath} -> ${newFileName}`);
            }
        }
    }
}

// Function to copy a single file from project root
function copyRootFile(projectRoot, destDir, filename, ig) {
    const fullPath = path.join(projectRoot, filename);

    if (!fs.existsSync(fullPath)) {
        console.log(`File not found: ${fullPath}`);
        return;
    }

    if (shouldIgnore(filename, filename, ig)) {
        console.log(`Ignored: ${filename}`);
        return;
    }

    const stats = fs.statSync(fullPath);
    if (stats.isFile() && hasValidExtension(filename)) {
        const destPath = path.join(destDir, filename);
        fs.copyFileSync(fullPath, destPath);
        console.log(`Copied: ${filename} -> ${filename}`);
    }
}

function ensureDirectoryExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        console.log(`Created directory: ${dirPath}`);
    }
}

function main() {
    const scriptDirPath = __dirname;
    const projectRoot = path.dirname(scriptDirPath); // Go up one level to project root
    const srcDirPath = path.join(projectRoot, SRC_FOLDER_NAME);
    const destDirPath = path.join(projectRoot, DEST_FOLDER_NAME);

    if (!fs.existsSync(srcDirPath)) {
        console.error(`Error: Source folder '${SRC_FOLDER_NAME}' not found at: ${srcDirPath}`);
        return;
    }

    // Ensure destination directory exists
    ensureDirectoryExists(destDirPath);

    const ig = readGitignore(projectRoot); // Gitignore from project root

    console.log(`Processing files from ${srcDirPath} to ${destDirPath}`);

    // Process each subfolder inside src/
    for (const item of SUBFOLDERS_AND_FILES) {
        const itemPath = path.join(srcDirPath, item);

        if (fs.existsSync(itemPath)) {
            const stats = fs.statSync(itemPath);

            if (stats.isDirectory()) {
                // Process directory
                console.log(`\nProcessing directory: ${SRC_FOLDER_NAME}/${item}/`);
                copyFilesToDestination(srcDirPath, destDirPath, itemPath, ig);
            }
        } else {
            console.log(`\nPath not found: ${itemPath}`);
        }
    }

    // Process root files (index.html)
    console.log(`\nProcessing root files:`);
    for (const file of ROOT_FILES) {
        copyRootFile(projectRoot, destDirPath, file, ig);
    }

    console.log("\nFinished copying and renaming files.");
}

main();
