import { errorResponse, json } from "@/lib/http";
import { getTour } from "@/lib/tour-data";

export async function GET() {
  try {
    return json(await getTour());
  } catch (error) {
    return errorResponse(error);
  }
}
