const path = require("node:path");

const { smokePackagedDesktopApp } = require("./smoke-packaged-desktop-app.cjs");

const EXECUTABLE_NAME = "Thoth";

exports.default = async function afterSign(context) {
  if (process.env.THOTH_DESKTOP_SMOKE !== "1") {
    return;
  }

  if (context.electronPlatformName !== "darwin") {
    return;
  }

  await smokePackagedDesktopApp({
    appPath: path.join(context.appOutDir, `${EXECUTABLE_NAME}.app`),
  });
};
