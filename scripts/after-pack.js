const fs = require('fs');
const path = require('path');

module.exports = async (context) => {
  const appOutDir = context.appOutDir;

  // 本应用用不到的运行时组件,删除以减小安装包:
  //  - dxcompiler.dll (WebGPU 专用,约 24 MB)
  //  - vk_swiftshader.dll / vulkan-1.dll (Vulkan 软渲染后备,约 7 MB,Chromium 走 D3D11/ANGLE)
  const drop = ['dxcompiler.dll', 'vk_swiftshader.dll', 'vk_swiftshader_icd.json', 'vulkan-1.dll'];
  for (const name of drop) {
    const p = path.join(appOutDir, name);
    if (fs.existsSync(p)) {
      try {
        fs.unlinkSync(p);
        console.log(`[afterPack] removed ${name}`);
      } catch (e) {
        console.warn(`[afterPack] cannot remove ${name}:`, e.message);
      }
    }
  }
};
