import { assertSameOrigin, errorResponse, json } from "@/lib/http";
import { visitCount } from "@/lib/visits";

export async function GET() {
  try { return json({ count: await visitCount() }); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    return json({ count: await visitCount(true) });
  } catch (error) { return errorResponse(error); }
}
