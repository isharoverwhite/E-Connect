import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    { detail: "Demo firmware artifact is currently disabled." },
    { status: 404 }
  );
}
