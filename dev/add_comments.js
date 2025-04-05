const fs = require('fs');
const path = require('path');
const ignorePackage = require('ignore');

// Define the source folder name
const SRC_FOLDER_NAME = 'public';
const JS_SUBFOLDER = 'js';

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

// Function to process .js files and add comment
function processJsFiles(startDir, currentDir, ig) {
    const items = fs.readdirSync(currentDir);

    for (const item of items) {
        const fullPath = path.join(currentDir, item);
        const relativePath = path.relative(startDir, fullPath);

        if (shouldIgnore(item, relativePath, ig)) continue;

        const stats = fs.statSync(fullPath);

        if (stats.isDirectory()) {
            processJsFiles(startDir, fullPath, ig); // Recursive call for directories
        } else {
            if (item.endsWith('.js')) {
                // Process only .js files
                addCommentToFile(startDir, fullPath, relativePath);
            }
        }
    }
}

function addCommentToFile(srcDir, filePath, relativePath) {
    try {
        let content = fs.readFileSync(filePath, 'utf8');
        const comment = `// Path: ${relativePath}\n`;
        const lines = content.split('\n');
        let firstLine = lines[0];

        if (firstLine.startsWith('//')) {
            // First line is already a comment, replace it
            lines[0] = comment.trim(); // Replace the first line with the new comment, trim to remove extra newline
            content = lines.join('\n');
            fs.writeFileSync(filePath, content, 'utf8');
            console.log(`Comment updated in: ${relativePath}`);
        } else {
            // First line is not a comment, prepend the comment
            content = comment + content;
            fs.writeFileSync(filePath, content, 'utf8');
            console.log(`Comment added to: ${relativePath}`);
        }
    } catch (error) {
        console.error(`Error processing file ${relativePath}: ${error.message}`);
    }
}

function main() {
    const scriptDirPath = __dirname;
    const projectRoot = path.dirname(scriptDirPath); // Go up one level to project root
    const srcDirPath = path.join(projectRoot, SRC_FOLDER_NAME);
    const jsDirPath = path.join(srcDirPath, JS_SUBFOLDER);

    if (!fs.existsSync(jsDirPath)) {
        console.error(`Error: Folder '${SRC_FOLDER_NAME}/${JS_SUBFOLDER}' not found at: ${jsDirPath}`);
        return;
    }

    console.log(`Running script from directory: ${jsDirPath}`);

    const ig = readGitignore(projectRoot); // Gitignore from project root
    processJsFiles(srcDirPath, jsDirPath, ig); // Start processing files from public/js folder

    console.log("Finished processing .js files.");
}

main();