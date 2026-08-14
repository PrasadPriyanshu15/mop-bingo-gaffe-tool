/** @type {import('next').NextConfig} */

// basePath/assetPrefix let the exported site work under GitHub Pages'
// project path (https://<user>.github.io/<repo>/). Locally it's empty.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig = {
  output: "export",
  basePath: basePath,
  assetPrefix: basePath || undefined,
  images: { unoptimized: true },
  trailingSlash: true,
  // wa-sqlite ships untranspiled ESM (the SQLite API + VFS base class we bundle).
  transpilePackages: ["wa-sqlite"],
};

export default nextConfig;
