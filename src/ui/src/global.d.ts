/// <reference types="vite/client" />
/// <reference types="chrome" />

// CSS module side-effect imports
declare module "*.css" {
  const content: Record<string, string>;
  export default content;
}
