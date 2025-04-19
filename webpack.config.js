const path = require("path");
const mode = process.env.NODE_ENV || "production";

module.exports = [
  {
    entry: "./renderer.tsx",
    context: __dirname,
    target: "electron-renderer",
    mode: mode,
    devtool: mode === "development" ? "source-map" : false,
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: "ts-loader",
          exclude: /node_modules/,
        },
        {
          test: /\.s?css$/,
          use: ["style-loader", "css-loader", "sass-loader"],
        },
        {
          test: /\.m?js/,
          resolve: {
            fullySpecified: false,
          },
        },
        {
          test: /\.svg$/,
          use: [
            {
              loader: "file-loader",
              options: {
                name: "[name].[ext]",
                outputPath: "icons",
              },
            },
          ],
        },
        {
          test: /\.(png|jpe?g|gif)$/i,
          use: [
            {
              loader: "file-loader",
              options: {
                name: "[name].[ext]",
                outputPath: "images",
              },
            },
          ],
        },
      ],
    },
    externals: [
      {
        "@freelensapp/extensions": "var global.LensExtensions",
        "@freelensapp/core": "var global.LensCore",
        "@freelensapp/kube-object": "var global.LensKubeObject",
        react: "var global.React",
        "react-dom": "var global.ReactDOM",
        mobx: "var global.Mobx",
        "mobx-react": "var global.MobxReact",
      },
    ],
    resolve: {
      extensions: [".tsx", ".ts", ".js", ".jsx", ".json"],
      alias: {
        "@k8slens/extensions": path.resolve("./node_modules/@freelensapp/extensions"),
      },
    },
    output: {
      libraryTarget: "commonjs2",
      globalObject: "this",
      filename: "renderer.js",
      path: path.resolve(__dirname, "dist"),
    },
    node: {
      __dirname: false,
      __filename: false,
    },
  },
];
