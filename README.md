# Freelens Resource Map Extension

> [!WARNING]
> This extension is currently in development and is considered unstable. The API is subject to change, and you may encounter bugs or incomplete features.
> Use it at your own risk, and contribute by reporting issues or suggesting improvements!

A Freelens extension to visualize Kubernetes resources and their relations as an interactive graph.

![Screenshot](./images/Screenshot.png)

## Features

- Interactive graph visualization of Kubernetes resources
- Resource relationship mapping (pods, services, deployments, etc.)
- Namespace filtering (in progress)
- Visual indicators for resource status and health
- Click navigation to resource details

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) version 22 or later
- [pnpm](https://pnpm.io/) package manager (latest version)

### Setup

1. Clone the repository:

   ```
   git clone https://github.com/omarluq/freelens-resource-map-extension.git
   cd freelens-resource-map-extension
   ```

2. Install dependencies:

   ```
   pnpm install
   ```

### Development Workflow

1. **Formatting**:

   ```
   pnpm format
   ```

   This will format your code using Biome.

2. **Linting**:

   ```
   pnpm lint
   ```

   This will check and fix code style issues using Biome.

3. **Building**:

   ```
   pnpm build
   ```

   This will compile the TypeScript code and create a production build in the `dist` directory.

4. **Packaging the Extension**:

   ```
   pnpm pack
   ```

   This will create a `.tgz` file that can be installed in Freelens.

### Installing the Extension in Freelens

1. After building and packing the extension, you'll have a `.tgz` file.
2. Open Freelens and navigate to Extensions.
3. Click "Install Extension" and select the `.tgz` file.

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run formatting, linting and build to make sure everything works (`pnpm format && pnpm lint && pnpm build`)
5. Commit your changes (`git commit -m 'Add some amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

## Credits

This extension is a modernized fork of the [Kube Resource Map](https://github.com/nevalla/lens-resource-map-extension) extension originally created by [Lauri Nevala](https://github.com/nevalla).

## License

MIT License - see the [LICENSE](./LICENSE) file for details.
