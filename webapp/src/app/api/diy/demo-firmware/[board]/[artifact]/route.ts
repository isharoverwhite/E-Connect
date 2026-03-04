import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

const DEMO_FIRMWARES: Record<string, Record<string, string>> = {
  "dfrobot-beetle-esp32-c3": {
    "bootloader.bin": path.resolve(
      process.cwd(),
      "../firmware/firmware/.pio/build/dfrobot_beetle_esp32c3/bootloader.bin",
    ),
    "partitions.bin": path.resolve(
      process.cwd(),
      "../firmware/firmware/.pio/build/dfrobot_beetle_esp32c3/partitions.bin",
    ),
    "firmware.bin": path.resolve(
      process.cwd(),
      "../firmware/firmware/.pio/build/dfrobot_beetle_esp32c3/firmware.bin",
    ),
  },
};

interface RouteContext {
  params: Promise<{
    board: string;
    artifact: string;
  }>;
}

export async function GET(_: Request, context: RouteContext) {
  const { board, artifact } = await context.params;
  const filePath = DEMO_FIRMWARES[board]?.[artifact];

  if (!filePath) {
    return NextResponse.json({ detail: "Demo firmware artifact not found." }, { status: 404 });
  }

  try {
    const file = await readFile(filePath);

    return new NextResponse(new Uint8Array(file), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "no-store",
        "Content-Disposition": `inline; filename="${artifact}"`,
        "Content-Length": String(file.byteLength),
      },
    });
  } catch (error) {
    console.error("Failed to read demo firmware artifact:", error);
    return NextResponse.json({ detail: "Unable to read demo firmware artifact." }, { status: 500 });
  }
}
