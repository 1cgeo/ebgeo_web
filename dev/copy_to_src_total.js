const fs = require('fs');
const path = require('path');
const ignorePackage = require('ignore');

// Define folder names
const SRC_FOLDER_NAME = 'public';
const JS_SUBFOLDER = 'js';
const DEST_FOLDER_NAME = 'src_total';

// List of folders to ignore
const FOLDERS_TO_IGNORE = ['.git', 'node_modules', 'vendors', 'images', 'assets'];

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

// Function to copy and rename files from src to src_total
function copyFilesToDestination(srcDir, destDir, currentDir, ig) {
    const items = fs.readdirSync(currentDir);

    for (const item of items) {
        const fullPath = path.join(currentDir, item);
        const relativePath = path.relative(srcDir, fullPath);

        if (shouldIgnore(item, relativePath, ig)) continue;

        const stats = fs.statSync(fullPath);

        if (stats.isDirectory()) {
            // Recursive call for directories
            copyFilesToDestination(srcDir, destDir, fullPath, ig);
        } else {
            if (item.endsWith('.js')) {
                // Process only .js files
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
    const jsDirPath = path.join(srcDirPath, JS_SUBFOLDER);
    const destDirPath = path.join(projectRoot, DEST_FOLDER_NAME);

    if (!fs.existsSync(jsDirPath)) {
        console.error(`Error: Source folder '${SRC_FOLDER_NAME}/${JS_SUBFOLDER}' not found at: ${jsDirPath}`);
        return;
    }

    // Ensure destination directory exists
    ensureDirectoryExists(destDirPath);

    console.log(`Copying files from ${jsDirPath} to ${destDirPath}`);

    const ig = readGitignore(projectRoot); // Gitignore from project root
    copyFilesToDestination(srcDirPath, destDirPath, jsDirPath, ig);

    console.log("Finished copying and renaming files.");
}

main();