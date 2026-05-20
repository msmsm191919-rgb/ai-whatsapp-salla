const fs = require('fs');
const path = require('path');

const src = 'C:/Users/mass_/.gemini/antigravity/brain/b9c70253-3067-403f-bfe5-b46c3aa58e1a/mobher_logo_1769964540099.png';
const destDir = path.join(__dirname, 'public', 'images');
const dest = path.join(destDir, 'logo.png');

if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
}

try {
    fs.copyFileSync(src, dest);
    console.log("Logo copied successfully to public/images/logo.png");
} catch (err) {
    console.error("Error copying logo:", err);
}
