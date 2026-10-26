# Mosspack 26.3

Private build of Mosspack on top of the Eaglercraft 26.3 single-file client (`~/Downloads/26-3.html`).
Output: `out/Mosspack-26.html` (one file, open it in Chrome, Edge or Brave).

```
python3 mod/build.py        # ~20 s: rebuilds out/Mosspack-26.html from 1-container/ + mod/
```

## Folders

| | |
|---|---|
| `1-container/` | the original file split into its parts (`node tools/unpack.mjs ~/Downloads/26-3.html 1-container`): client / server / mesh WebAssembly (Brotli-decoded), assets and sounds EPK, the six loader scripts, `client-strings.json` (string pool dump) |
| `2-wasm/` | analysis of the client module: `header.wat` (types, imports, globals), `funcs.tsv` (all 200,914 functions with sizes), `string-globals.json` (pool string -> global, in the order TeaVM's initializers `$200806`..`$200904` fill them) |
| `3-assets/` | `assets.epk` extracted |
| `mod/` | `build.py` (all changes), `preflight.html` (browser check, #reset, stall message), `js/skip-profile.js`, `art/` |
| `tools/` | `unpack.mjs`, `pack.mjs` (rebuild the HTML), `strpool.py` (edit the string pool; may shrink, never grow past segment 1), `epk.py`, `watscan.py` (stream-filter `wasm-dis` output: the full text is >14 GB), `wasmpatch.py` (patch function bodies in the binary: prepend, same-length swap) |

## What the build changes

- Title screen: "Mosspack 26.3 / Made by slizsy", nothing under the Minecraft logo; about 40% of splashes say
  "made by slizsy".
- Eaglercraft named nowhere a player looks: brand, relay names, connection labels, messages, connection
  errors, error pages, crash reports (the Credits screen still credits the Eaglercraft authors).
- No pinned ArchMC server in Multiplayer (code patches: `$135682` returns at once; the `list.add(0, ArchMC)` call
  in `$164086` and `$29203` is replaced by three drops). No Relays / Isolated App links (empty labels).
- Open to LAN: pause menu "Open to LAN..." -> "Open to LAN: ON" -> Apply; the join code appears in chat.
  Friends: Singleplayer -> Join LAN World. The relay address is wss://lan.mosspack, answered in the page by
  `mod/js/lan-relay.js` (the game's relay protocol, signaling over ntfy.sh, public STUN); nothing goes to
  any Eaglercraft server (no address of theirs is left in the game code; the relay proxy to Java servers is gone).
  Strict networks need a TURN relay: add `lanTurnServers: [{url, username, credential}]` to eaglercraftXOpts.
- Profile: the 25 preset capes are official capes with their official names (`mod/art/capes/`, names from
  SkinMC and the Minecraft Wiki); the other official capes are added once to the profile's own cape list
  (`mod/js/seed-capes.js`). Preset skins: Minecraft's 9 default characters (wide and slim) and jeb_,
  Dinnerbone, Notch and Grumm; Creeper, Zombie and Pig stay (their labels are also the mob names).
- Wardrobe (the title screen's profile button; `mod/js/wardrobe.js`): every preset and custom skin and cape with a 3D
  preview (skinview3d, MIT, `mod/vendor/`), uploads, username; saving writes the profile and restarts. The game's
  own Edit Profile dropdowns don't open in this build (the dropdown widget is never given clicks or drawn), so this
  replaces them: Edit Profile's constructor ($14404) raises the exported flag `mosspack.profile`, the page opens the
  Wardrobe and closes Edit Profile (ignored at launch, when the game opens Edit Profile by itself). Preset skins include two fun ones, Claude and Mosspack (`mod/art/make_skins.py`).
- Colored FPS / TPS counter: FPS >= 60 green, > 20 yellow, else red; TPS >= 19.5 green, >= 15 yellow, else red
  (code patches in $5959 / $47261 and one added global).
- Crash assistant (`mod/js/crash-assistant.js`): explains what went wrong, with fixes, Reload / Copy / Save report.
- F3 reads "Minecraft 26.3 (26.3/mosspack)" ($61178 points at another string; "eagler" is also an asset namespace).
- Fullscreen works (`mod/js/fullscreen.js`): a request the browser refuses is made again on the next click/key.
- Loading bar (`mod/js/loading.js`): unpacking + compiling the game code, then the game's own boot stages.
- New-world chooser reworded; world files are `.mosspack` (same data format as before).
- Brightness at maximum is "Fullbright" (patched lightmap shader in the baked WebGL shader pack).
- No "Default Username Detected" prompt (its name patterns never match) and no Edit Profile on launch
  (one Escape when the first screen appears; still reachable from the title screen's profile icon).
- ArchMC cloud saves off (`eaglercraftXOpts.zeusCloud.enabled = false`); analytics requests dropped.
- Its own crash-report storage and a clear message if part of the file is missing.
- Dark loading screen with the Mosspack logo; browser check; `Mosspack-26.html#reset` wipes saved data.
- The world-server worker reads the asset pack size from the page (it was hard-coded).

Already in 26.3 and kept: Sodium/Lithium-style options (Video Settings -> Performance), Show FPS & TPS
(Video Settings -> Preferences), Damage Tilt (Accessibility).

LAN is 26.3's own: World Options -> Relay LAN: ON (code in chat), friends use Singleplayer -> Join LAN World.

Not changed (screen layouts and these features live in optimized game code with no names, so there is nothing
safe to patch): button positions, the Mods button (ArchMC's Lua mods), 1.12's Zoom and F4 keys.
Internal names (classes, storage keys, protocol, file formats, log lines) are left as they are.

Contains Minecraft code and assets (© Mojang/Microsoft) and is based on Eaglercraft 26.3 (o_xer + ArchMC) and
EaglercraftX (lax1dude): keep it private, don't share or host it.
