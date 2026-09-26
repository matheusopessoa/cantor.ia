import type { ReactNode } from "react";
import { AlertIcon, HeadphonesIcon } from "./icons";

export type AlertTone = "danger" | "warning" | "success" | "info";

interface AlertProps {
  tone: AlertTone;
  title: string;
  body?: ReactNode;
  icon?: "alert" | "headphones";
}

/** `.ct-alert` do design system: erro, aviso ou dica com ícone. */
export function Alert({ tone, title, body, icon = "alert" }: AlertProps) {
  const IconComponent = icon === "headphones" ? HeadphonesIcon : AlertIcon;
  return (
    <div className={`ct-alert ct-alert--${tone}`} role={tone === "danger" ? "alert" : "status"}>
      <IconComponent />
      <div>
        <div className="ct-alert__title">{title}</div>
        {body ? <div className="ct-alert__body">{body}</div> : null}
      </div>
    </div>
  );
}
