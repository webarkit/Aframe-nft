# Aframe-nft 📷

## Introduction 🌟

Aframe-nft is a project that integrates Aframe with ARnft to create augmented reality experiences using NFT (Natural Feature Tracking). This project allows you to anchor 3D objects to real-world markers and interact with them in a web-based AR environment.

## Example 📝

Here is a simple example of how to use Aframe-nft in your HTML file:

```html
<!DOCTYPE html>
<html>
  <head>
    <title>Aframe-nft Example</title>
    <script src="path/to/your/built/AframeNft.js"></script>
  </head>
  <body>
    <a-scene>
      <a-nft url="examples/dataNFT/pinball" name="pinball"></a-nft>
      <a-entity gltf-model="url(path/to/your/model.gltf)" position="0 0 0"></a-entity>
      <a-camera position="0 0 5"></a-camera>
    </a-scene>
  </body>
</html>
```

## Building the Project 🛠️
To build the project, follow these steps:

1. Clone the repository:

`git clone https://github.com/webarkit/Aframe-nft.git`

2. Install the dependencies:

`cd Aframe-nft
npm install`
3. Build the project for production
`npm run build`
4. For development mode with live reloading:
`npm run build:dev`
5. Start the development server:
`npm start`

## Work in Progress 🚧
Please note that this project is still a work in progress (WIP). Features and functionalities are continuously being developed and improved. Contributions and feedback are welcome.






