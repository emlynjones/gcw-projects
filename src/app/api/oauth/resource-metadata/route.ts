import { protectedResourceHandler, metadataCorsOptionsRequestHandler } from "mcp-handler";
import { issuerUrl } from "@/lib/oauth";

export function GET(req: Request) {
  return protectedResourceHandler({ authServerUrls: [issuerUrl()], resourceUrl: `${issuerUrl()}/api/mcp` })(req);
}
export const OPTIONS = metadataCorsOptionsRequestHandler();
