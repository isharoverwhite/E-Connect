/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const iconUrl = new URL("/icon.svg", request.url);
  return NextResponse.redirect(iconUrl, 307);
}
