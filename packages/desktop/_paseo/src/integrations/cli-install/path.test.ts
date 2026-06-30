import { describe, expect, it } from "vitest";
import { resolveCliInstallSourcePath } from "./path";

describe("cli-install-path", () => {
  it("uses the bundled shim for packaged macOS installs", () => {
    expect(
      resolveCliInstallSourcePath({
        platform: "darwin",
        isPackaged: true,
        executablePath: "/Applications/Thoth.app/Contents/MacOS/Thoth",
        shimPath: "/Applications/Thoth.app/Contents/Resources/bin/thoth",
      }),
    ).toBe("/Applications/Thoth.app/Contents/Resources/bin/thoth");
  });

  it("prefers the original AppImage path on linux", () => {
    expect(
      resolveCliInstallSourcePath({
        platform: "linux",
        isPackaged: true,
        executablePath: "/tmp/.mount_thoth123/thoth",
        shimPath: "/tmp/.mount_thoth123/resources/bin/thoth",
        appImagePath: "/home/user/Applications/Thoth.AppImage",
      }),
    ).toBe("/home/user/Applications/Thoth.AppImage");
  });

  it("falls back to the shim on windows and in development", () => {
    expect(
      resolveCliInstallSourcePath({
        platform: "win32",
        isPackaged: true,
        executablePath: "C:\\Users\\user\\AppData\\Local\\Programs\\Thoth\\Thoth.exe",
        shimPath: "C:\\Users\\user\\AppData\\Local\\Programs\\Thoth\\resources\\bin\\thoth.cmd",
      }),
    ).toBe("C:\\Users\\user\\AppData\\Local\\Programs\\Thoth\\resources\\bin\\thoth.cmd");

    expect(
      resolveCliInstallSourcePath({
        platform: "linux",
        isPackaged: false,
        executablePath: "/opt/Thoth/thoth",
        shimPath: "/opt/Thoth/resources/bin/thoth",
      }),
    ).toBe("/opt/Thoth/resources/bin/thoth");
  });
});
