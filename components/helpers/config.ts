import type React from "react";

export type ConfigItem = {
  color: string;
  size: number;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>> | string; // Icon can be an SVG React component or URL string
  tooltipClass?: React.ComponentType;
};

type Config = {
  [key: string]: ConfigItem;
};

// Use image URLs for Kubernetes resources
export const config: Config = {
  deployment: {
    color: "#6771dc",
    icon: "https://raw.githubusercontent.com/kubernetes/community/master/icons/svg/resources/unlabeled/deploy.svg",
    size: 25,
  },
  daemonset: {
    color: "#a367dc",
    icon: "https://raw.githubusercontent.com/kubernetes/community/master/icons/svg/resources/unlabeled/ds.svg",
    size: 25,
  },
  statefulset: {
    color: "#dc67ce",
    icon: "https://raw.githubusercontent.com/kubernetes/community/master/icons/svg/resources/unlabeled/sts.svg",
    size: 25,
  },
  service: {
    color: "#808af5",
    icon: "https://raw.githubusercontent.com/kubernetes/community/master/icons/svg/resources/unlabeled/svc.svg",
    size: 22,
  },
  secret: {
    color: "#ff9933",
    icon: "https://raw.githubusercontent.com/kubernetes/community/master/icons/svg/resources/unlabeled/secret.svg",
    size: 22,
  },
  configmap: {
    color: "#ff9933",
    icon: "https://raw.githubusercontent.com/kubernetes/community/master/icons/svg/resources/unlabeled/cm.svg",
    size: 22,
  },
  pod: {
    color: "#80f58e",
    icon: "https://raw.githubusercontent.com/kubernetes/community/master/icons/svg/resources/unlabeled/pod.svg",
    size: 22,
  },
  ingress: {
    color: "#67dcbb",
    icon: "https://raw.githubusercontent.com/kubernetes/community/master/icons/svg/resources/unlabeled/ing.svg",
    size: 22,
  },
  helmrelease: {
    color: "#0f1689",
    icon: "https://raw.githubusercontent.com/kubernetes/icons/master/svg/helm.svg",
    size: 25,
  },
  persistentvolumeclaim: {
    color: "#cdff93",
    icon: "https://raw.githubusercontent.com/kubernetes/community/master/icons/svg/resources/unlabeled/pvc.svg",
    size: 22,
  },
};
