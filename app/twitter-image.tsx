// Twitter card thumbnail. Same composition as the OG image — duplicated
// here (instead of re-exported) because Next.js / Turbopack requires
// route-segment-config exports (`runtime`, `alt`, `size`, `contentType`)
// to be defined inline, not re-exported, in image metadata files.

import OpengraphImage, {
  alt as ogAlt,
  size as ogSize,
  contentType as ogContentType,
} from "./opengraph-image";

export const runtime = "edge";
export const alt = ogAlt;
export const size = ogSize;
export const contentType = ogContentType;

export default OpengraphImage;
