# mpv Windows binary provenance

- Upstream project: <https://github.com/mpv-player/mpv>
- Release: `v0.41.0`
- Source commit: `41f6a645068483470267271e1d09966ca3b9f413`
- Official asset: `mpv-v0.41.0-x86_64-pc-windows-msvc.zip`
- Asset URL: <https://github.com/mpv-player/mpv/releases/download/v0.41.0/mpv-v0.41.0-x86_64-pc-windows-msvc.zip>
- Asset SHA-256: `4E197F729F5071C6772F35FFFD96E0F36E3E8A044BD9479B136BB09B7C6A80FF`
- Official build run: <https://github.com/mpv-player/mpv/actions/runs/20414542745>
- Build script: <https://github.com/mpv-player/mpv/blob/41f6a645068483470267271e1d09966ca3b9f413/ci/build-win32.ps1>

The pinned build script explicitly uses `-Dgpl=true` and `-Dffmpeg:gpl=enabled`. Treat this bundled executable as GPL software; do not describe it as an LGPL build.

Local files were compared byte-for-byte by SHA-256 against the extracted official asset on 2026-07-18:

| File | SHA-256 |
|---|---|
| `mpv.exe` | `6145E63F026451A764077D53FD60860EC9F5C2BC76DCD6E62A88967AC375453D` |
| `mpv.com` | `9038FF36858E99624064F4EC6BE2BB666985482AAD234A2E38EF72562148AFF7` |
| `mpv.pdb` | `834F928D1D5D9665B35244A49E852D24C9616456FDA81AAE23E936706FFF2D68` |
| `vulkan-1.dll` | `2BAAE0A109CB5962437B00A182750308CE9F69F59381DF62939C00C21150EE6B` |
| `mpv-register.bat` | `E3C354D13BFE4AE2B9BAFBD1B7609753C47F78A3A4989B082F34D5A938AA7A09` |
| `mpv-unregister.bat` | `D40F2F76E00E08287C39C15654E9350831E4418F1BD9619BC8DCFF0DFB055E91` |

Before publishing an installer, attach or host a complete corresponding-source bundle for this exact official CI build and keep it available under the applicable GPL terms. The upstream tag alone is not a substitute for checking all statically linked subprojects.
