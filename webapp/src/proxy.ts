import { NextRequest, NextResponse } from "next/server";

const HSTS_HEADER_VALUE = "max-age=31536000; includeSubDomains";

function allowsInsecureHttp() {
  return process.env.ALLOW_INSECURE_HTTP === "1";
}

function isSecureRequest(request: NextRequest) {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto) {
    return forwardedProto.split(",")[0]?.trim() === "https";
  }

  return request.nextUrl.protocol === "https:";
}

function attachSecurityHeaders(response: NextResponse, secureRequest: boolean) {
  if (!allowsInsecureHttp() && secureRequest) {
    response.headers.set("Strict-Transport-Security", HSTS_HEADER_VALUE);
  } else {
    response.headers.delete("Strict-Transport-Security");
  }

  return response;
}

export function proxy(request: NextRequest) {
  const secureRequest = isSecureRequest(request);
  if (secureRequest || allowsInsecureHttp()) {
    return attachSecurityHeaders(NextResponse.next(), secureRequest);
  }

  const redirectUrl = request.nextUrl.clone();
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost ?? request.headers.get("host");

  redirectUrl.protocol = "https";
  if (host) {
    redirectUrl.host = host;
  }

  return attachSecurityHeaders(NextResponse.redirect(redirectUrl, 308), false);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|_next/webpack-hmr|favicon.ico).*)"],
};
