/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

import type * as React from "react";

type EspWebInstallButtonProps = React.DetailedHTMLProps<
  React.HTMLAttributes<HTMLElement>,
  HTMLElement
> & {
  manifest?: string;
  "erase-first"?: string;
};

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "esp-web-install-button": EspWebInstallButtonProps;
    }
  }
}

declare module "react/jsx-runtime" {
  namespace JSX {
    interface IntrinsicElements {
      "esp-web-install-button": EspWebInstallButtonProps;
    }
  }
}

export {};
