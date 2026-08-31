/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // The scheduler in src/ uses ESM-style imports with explicit `.js`
    // extensions (e.g. `from './types.js'`) that actually point at `.ts`
    // files. Teach webpack to resolve them.
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;
