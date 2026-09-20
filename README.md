# Aframe-nft 📷

A-Frame components for markerless AR using **NFT (Natural Feature Tracking)**, powered
by [`@webarkit/jsartoolkit-nft`](https://github.com/webarkit/jsartoolkitNFT).
Declare an image target with `<a-nft>` and anchor any A-Frame mesh to it.

## Features ✨

- Declarative `<a-nft>` primitive — point it at an NFT descriptor set and drop a mesh inside.
- Direct jsartoolkitNFT integration; detection runs per frame.
- Camera/overlay alignment modelled on AR.js: the video and the WebGL canvas are sized to
  the same source-aspect box, so the 3D registers with the video for **any** camera
  parameter file — no per-device tweaking.
- Vite tooling: fast dev server with HMR, plus an IIFE library build.

## Requirements 📋

- A **webcam**.
- A **secure context** — `getUserMedia` requires `https://` or `http://localhost`.
- An **NFT descriptor set** (`.fset`, `.fset3`, `.iset`) and an ARToolKit **camera
  parameter** file (`camera_para.dat`). The repo ships a `pinball` target and camera file
  under [`examples/`](examples/).

## Getting started 🛠️

```bash
git clone https://github.com/webarkit/Aframe-nft.git
cd Aframe-nft
npm install
```

| Command | What it does |
|---------|--------------|
| `npm run dev` | Start the Vite dev server (HMR) and open the example |
| `npm run build` | Build the IIFE bundle to `dist/AframeNft.js` |
| `npm test` | Run the unit tests (Vitest) |
| `npm run preview` | Preview a production build |

Then open `http://localhost:8080/examples/basic.html` and point the camera at the
[`pinball` target](examples/DataNFT/).

## Usage 📝

Include the built bundle, provide a `#video` element for the camera feed, and put your mesh
inside `<a-nft>`. The `<a-scene>` must be `embedded` so the canvas can be aligned to the
video.

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
    <style>
      body { margin: 0; }
      #video { position: absolute; top: 0; left: 0; }
    </style>
    <script src="path/to/dist/AframeNft.js"></script>
  </head>
  <body>
    <video loop autoplay muted playsinline id="video"></video>

    <a-scene embedded arnft="videoWidth: 1280; videoHeight: 720; cameraParam: path/to/camera_para.dat">
      <a-nft url="path/to/DataNFT/pinball" name="pinball">
        <a-box color="#4CC3D9"></a-box>
      </a-nft>

      <a-camera position="0 0 0" look-controls="enabled: false"></a-camera>
    </a-scene>
  </body>
</html>
```

`url` points at the descriptor set **without** file extension (jsartoolkitNFT appends
`.fset` / `.fset3` / `.iset`). Relative `url` / `cameraParam` paths resolve relative to the
HTML page, like any other asset URL.

## API reference 📖

### `arnft` system — configured on `<a-scene>`

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `videoWidth` | number | `640` | Requested capture width |
| `videoHeight` | number | `480` | Requested capture height |
| `cameraParam` | string | `Data/camera_para.dat` | ARToolKit camera parameter file |

### `<a-nft>` primitive (`nft-anchor` component)

| Attribute | Maps to | Type | Default | Description |
|-----------|---------|------|---------|-------------|
| `url` | `markerUrl` | string | `DataNFT/pinball` | NFT descriptor set (no extension) |
| `name` | `entityName` | string | `pinball` | Label for the marker |
| `nft-anchor="scaleFactor: …"` | `scaleFactor` | number | `150` | Uniform mesh scale (pose units are mm) |
| `nft-anchor="lift: …"` | `lift` | boolean | `true` | Lift the mesh to rest ON the marker (`false` centers it on the plane) |
| `nft-anchor="offsetX: …"` | `offsetX` | number | `0` | Fine X nudge in marker mm (usually unneeded) |
| `nft-anchor="offsetY: …"` | `offsetY` | number | `0` | Fine Y nudge in marker mm (usually unneeded) |
| `nft-anchor="smooth: …"` | `smooth` | boolean | `true` | Enable 1€ pose smoothing (reduces jitter) |
| `nft-anchor="smoothMinCutoff: …"` | `smoothMinCutoff` | number | `0.0001` | Baseline smoothing — lower is smoother but laggier |
| `nft-anchor="smoothBeta: …"` | `smoothBeta` | number | `0.01` | Speed coefficient — higher reduces lag while moving |

The mesh is centered on the marker and lifted to rest on its surface automatically.
Pose smoothing is on by default; set `smooth: false` to compare the raw pose.

### ⚠️ Print your marker at 100% scale

**The most common cause of a misaligned overlay is a badly printed target**, not a code or
calibration problem. The NFT descriptor encodes the marker's real-world size, and the tracker
solves the pose against *those* dimensions. If the print is scaled — especially non-uniformly,
which "Fit to Page" does — the pose is systematically wrong and the overlay drifts to one side
(typically overshooting the right edge).

For the bundled `pinball` target (893 × 1117 px @ 120 dpi) a correct print measures:

| | expected |
|---|---|
| width | **189.0 mm** (`893 / 120 × 25.4`) |
| height | **236.4 mm** (`1117 / 120 × 25.4`) |
| aspect | **0.7995** |

Check it with a ruler. If width and height are off by *different* ratios, the print is
squashed — reprint at **100% / Actual Size**, with scaling and "Fit to Page" turned **off**.

To rule printing out entirely, display the
[source image](https://raw.githubusercontent.com/artoolkitx/artoolkit5/master/doc/Marker%20images/pinball.jpg)
on a phone or monitor at 1:1 and point the camera at the screen. (Note the mesh will look
oversized there, because a screen-displayed marker is physically much smaller than the
189 mm the descriptor assumes — that's expected, not a misalignment.)

See [webarkit/jsfeatNext#142](https://github.com/webarkit/jsfeatNext/issues/142), where this
was diagnosed and confirmed for this exact target.

## How it works 🔍

The `arnft` system starts the camera, initializes `ARControllerNFT`, applies the tracker's
projection to the A-Frame camera, and runs `process()` each frame. Each `<a-nft>` registers
its descriptor set and receives pose callbacks; the `nft-anchor` component converts the
right-handed pose matrix into the mesh's transform, centered via the marker's real-world
size (DPI-scaled millimetres).

## Roadmap / known limitations 🚧

- **One target tracked at a time.** You can declare several `<a-nft>` elements and all of
  them are loaded, but jsartoolkitNFT tracks a single target at a time, so they **alternate**
  rather than appearing together — see
  [jsartoolkitNFT#613](https://github.com/webarkit/jsartoolkitNFT/issues/613).
- **Targets must be declared up front.** Markers are loaded in one batch; an `<a-nft>` added
  after tracking has started is not tracked (it warns), because markers cannot be loaded
  incrementally — see
  [jsartoolkitNFT#612](https://github.com/webarkit/jsartoolkitNFT/issues/612).
- **Main-thread detection** — a Web Worker is a future optimization.
- A tall mesh standing on the marker shows correct perspective parallax that can read as a
  shift when viewed at a steep angle.

Contributions and feedback welcome.

## License 📄

LGPL-3.0-or-later.
