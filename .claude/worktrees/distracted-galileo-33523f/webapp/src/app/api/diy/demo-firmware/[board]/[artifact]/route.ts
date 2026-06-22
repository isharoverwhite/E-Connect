/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    { detail: "Demo firmware artifact is currently disabled." },
    { status: 404 }
  );
}
