import "./KubeForceChart.scss";
import { Common, Renderer } from "@freelensapp/extensions";
import { comparer, observable, reaction, values } from "mobx";
import { disposeOnUnmount, observer } from "mobx-react";
import React, { createRef, Fragment, type MutableRefObject } from "react";
import { Network } from "vis-network";
import { DataSet } from "vis-data";
import * as d3 from "d3-force";
import * as ReactDOM from "react-dom";
import {
  PodTooltip,
  ServiceTooltip,
  DeploymentTooltip,
  StatefulsetTooltip,
  DefaultTooltip,
  IngressTooltip,
} from "./tooltips";
import { config, type ConfigItem } from "./helpers/config";
import type { ChartDataSeries, LinkObject, NodeObject } from "./helpers/types";
import type { KubeObject } from "@freelensapp/kube-object";

export interface KubeResourceChartProps {
  id?: string; // html-id to bind chart
  object?: Renderer.K8sApi.KubeObject;
}

interface State {
  nodes: ChartDataSeries[];
  links: LinkObject[];
  highlightLinks?: Set<LinkObject>;
  hoverNode?: string;
  showTooltipForObject?: Renderer.K8sApi.KubeObject;
}

type VisNodeColor = {
  background?: string;
  border?: string;
  highlight?: {
    background?: string;
    border?: string;
  };
};

type VisEdgeColor = {
  color?: string;
  highlight?: string;
};

type VisEdgeSmooth = {
  enabled: boolean;
  type: string;
  roundness: number;
  forceDirection?: string | boolean;
};

@observer
export class KubeResourceChart extends React.Component<KubeResourceChartProps, State> {
  @observable static isReady = false;
  @observable isUnmounting = false;
  @observable data: State;

  static defaultProps: KubeResourceChartProps = {
    id: "kube-resource-map",
  };

  protected links: LinkObject[] = [];
  protected nodes: ChartDataSeries[] = [];
  protected highlightLinks: Set<LinkObject> = new Set<LinkObject>();
  protected initZoomDone = false;
  protected images: { [key: string]: HTMLImageElement } = {};
  protected config = config;
  private chartRef: MutableRefObject<HTMLDivElement | null>;
  protected network: Network | null = null;
  protected networkContainer = React.createRef<HTMLDivElement>();

  protected podsStore = Renderer.K8sApi.apiManager.getStore(
    Renderer.K8sApi.podsApi,
  ) as Renderer.K8sApi.PodsStore;
  protected deploymentStore = Renderer.K8sApi.apiManager.getStore(
    Renderer.K8sApi.deploymentApi,
  ) as Renderer.K8sApi.DeploymentStore;
  protected statefulsetStore = Renderer.K8sApi.apiManager.getStore(
    Renderer.K8sApi.statefulSetApi,
  ) as Renderer.K8sApi.StatefulSetStore;
  protected daemonsetStore = Renderer.K8sApi.apiManager.getStore(
    Renderer.K8sApi.daemonSetApi,
  ) as Renderer.K8sApi.DaemonSetStore;
  protected secretStore = Renderer.K8sApi.apiManager.getStore(
    Renderer.K8sApi.secretsApi,
  ) as Renderer.K8sApi.SecretsStore;
  protected serviceStore = Renderer.K8sApi.apiManager.getStore(
    Renderer.K8sApi.serviceApi,
  ) as Renderer.K8sApi.ServiceStore;
  protected pvcStore = Renderer.K8sApi.apiManager.getStore(
    Renderer.K8sApi.pvcApi,
  ) as Renderer.K8sApi.VolumeClaimStore;
  protected ingressStore = Renderer.K8sApi.apiManager.getStore(
    Renderer.K8sApi.ingressApi,
  ) as Renderer.K8sApi.IngressStore;
  protected configMapStore = Renderer.K8sApi.apiManager.getStore(
    Renderer.K8sApi.configMapApi,
  ) as Renderer.K8sApi.ConfigMapsStore;

  protected kubeObjectStores: Renderer.K8sApi.KubeObjectStore[] = [];
  private watchDisposers: (() => void)[] = [];
  private disposers: (() => void)[] = [];

  state: Readonly<State> = {
    nodes: [],
    links: [],
    highlightLinks: new Set<LinkObject>(),
  };

  constructor(props: KubeResourceChartProps) {
    super(props);
    this.chartRef = createRef();
    this.generateImages();
  }

  async componentDidMount() {
    this.setState(this.state);

    this.registerStores();

    await this.loadData();

    this.displayChart();

    // Initialize network visualization after data is loaded
    setTimeout(() => {
      if (KubeResourceChart.isReady && this.nodes.length > 0) {
        this.updateNetwork();
      }
    }, 100);

    const reactionOpts = {
      equals: comparer.structural,
    };

    const { object } = this.props;
    const api = Renderer.K8sApi.apiManager.getApiByKind(object.kind, object.apiVersion);
    const store = Renderer.K8sApi.apiManager.getStore(api);

    this.disposers.push(
      reaction(
        () => this.props.object,
        (value, prev, _reaction) => {
          value.getId() !== prev.getId() ? this.displayChart() : this.refreshChart();
        },
      ),
    );
    this.disposers.push(
      reaction(
        () => this.podsStore.items.toJSON(),
        (values, previousValue, _reaction) => {
          this.refreshItems(values, previousValue);
        },
        reactionOpts,
      ),
    );
    this.disposers.push(
      reaction(
        () => store.items.toJSON(),
        (values, previousValue, _reaction) => {
          this.refreshItems(values, previousValue);
        },
        reactionOpts,
      ),
    );
  }

  componentDidUpdate() {
    // Only create or update the network if we have nodes to display
    if (KubeResourceChart.isReady && this.nodes.length > 0) {
      this.updateNetwork();
    }
  }

  registerStores() {
    const object = this.props.object;

    this.kubeObjectStores = [
      this.podsStore,
      this.serviceStore,
      this.ingressStore,
      this.pvcStore,
      this.configMapStore,
      this.secretStore,
    ];
    if (object instanceof Renderer.K8sApi.Deployment) {
      this.kubeObjectStores.push(this.deploymentStore);
    } else if (object instanceof Renderer.K8sApi.DaemonSet) {
      this.kubeObjectStores.push(this.daemonsetStore);
    } else if (object instanceof Renderer.K8sApi.StatefulSet) {
      this.kubeObjectStores.push(this.statefulsetStore);
    }
  }

  displayChart = () => {
    console.log("displayChart");
    this.initZoomDone = false;
    this.nodes = [];
    this.links = [];
    this.generateChartDataSeries();
    this.setState({
      nodes: this.nodes,
      links: this.links,
    });
  };

  refreshChart = () => {
    console.log("refreshChart");
    this.generateChartDataSeries();
    this.setState({
      nodes: this.nodes,
      links: this.links,
    });
  };

  getLinksForNode(node: ChartDataSeries): LinkObject[] {
    return this.links.filter(
      (link) =>
        link.source === node.id ||
        link.target === node.id ||
        (link.source as NodeObject).id === node.id ||
        (link.target as NodeObject).id === node.id,
    );
  }

  handleNodeClick = (params: { nodes?: string[] }) => {
    if (params.nodes && params.nodes.length > 0) {
      const nodeId = params.nodes[0];
      const node = this.nodes.find((n) => n.id === nodeId);

      if (node?.object) {
        if (node.object.kind === "HelmRelease") {
          const path = `/apps/releases/${node.object.getNs()}/${node.object.getName()}?`;
          Renderer.Navigation.navigate(path);
        } else {
          const detailsUrl = Renderer.Navigation.getDetailsUrl(node.object.selfLink);
          Renderer.Navigation.navigate(detailsUrl);
        }
      }
    }
  };

  handleNodeHover = (params: { node?: string }) => {
    if (params.node) {
      const nodeId = params.node;
      const elem = document.getElementById(this.props.id);
      if (elem) elem.style.cursor = "pointer";

      const node = this.nodes.find((n) => n.id === nodeId);

      if (node) {
        const highlightLinks = new Set<LinkObject>();
        const links = this.getLinksForNode(node);
        for (const link of links) {
          highlightLinks.add(link);
        }

        this.setState({
          highlightLinks,
          hoverNode: nodeId,
          showTooltipForObject: node.object,
        });
      }
    } else {
      const elem = document.getElementById(this.props.id);
      if (elem) elem.style.cursor = null;

      this.setState({
        highlightLinks: new Set<LinkObject>(),
        hoverNode: undefined,
        showTooltipForObject: undefined,
      });
    }
  };

  // SVG icons are now imported as React components
  // No need to preload images
  generateImages() {
    // This method is kept for compatibility but does nothing now
  }

  componentWillUnmount() {
    this.isUnmounting = true;
    this.nodes = [];
    this.links = [];
    this.unsubscribeStores();

    // Clean up the network
    if (this.network) {
      this.network.destroy();
      this.network = null;
    }

    for (const disposer of this.disposers) {
      disposer();
    }
  }

  protected refreshItems(
    newValues: Renderer.K8sApi.KubeObject[],
    previousValues: KubeObject[] = [],
  ) {
    const newItems = Array.from(newValues);
    const itemsToRemove = previousValues.filter(
      (item) =>
        !newItems.find((item2: Renderer.K8sApi.KubeObject) => item.getId() === item2.getId()),
    );

    for (const object of itemsToRemove) {
      if (["DaemonSet", "StatefulSet", "Deployment"].includes(object.kind)) {
        const helmReleaseName = this.getHelmReleaseName(object);
        if (helmReleaseName) {
          const helmReleaseNode = this.getHelmReleaseChartNode(helmReleaseName, object.getNs());
          if (this.getLinksForNode(helmReleaseNode).length === 1) {
            this.deleteNode({ node: helmReleaseNode });
          }
        }
      }
      this.deleteNode({ object });
    }

    this.generateChartDataSeries();
  }

  protected unsubscribeStores() {
    for (const dispose of this.watchDisposers) {
      dispose();
    }
    this.watchDisposers.length = 0;
  }

  protected async loadData() {
    this.unsubscribeStores();
    for (const store of this.kubeObjectStores) {
      try {
        if (!store.isLoaded) {
          await store.loadAll();
        }
        const unsuscribe = store.subscribe();
        this.watchDisposers.push(unsuscribe);
      } catch (error) {
        console.error("loading store error", error);
      }
    }
    KubeResourceChart.isReady = true;
  }

  generateChartDataSeries = () => {
    const oldNodes = [...this.nodes];
    const oldLinks = [...this.links];

    this.generateControllerNode(this.props.object);
    this.generateIngresses();

    // Only update state if the data has changed
    if (oldNodes.length !== this.nodes.length || oldLinks.length !== this.links.length) {
      this.updateState(this.nodes, this.links);
    }
  };

  protected updateState(nodes: ChartDataSeries[], links: LinkObject[]) {
    this.setState({
      nodes: nodes,
      links: links,
    });
  }

  updateNetwork() {
    const container = document.getElementById(`${this.props.id}-network`);
    if (!container) return;

    const theme = Renderer.Theme.getActiveTheme();
    const sidebarWidth =
      (document.querySelectorAll('[data-testid="cluster-sidebar"]')[0] as HTMLElement)
        ?.offsetWidth || 200;
    const graphWidth = window.innerWidth - 70 - sidebarWidth;
    const graphHeight = 400;

    // Destroy existing network if any
    if (this.network) {
      this.network.destroy();
      this.network = null;
    }

    // Convert the nodes and links to vis-network format
    const visNodes = this.nodes.map((node) => {
      const kind = node.kind.toLowerCase();
      const nodeConfig = this.config[kind] || {};

      return {
        id: node.id,
        label: node.name,
        color: {
          background: node.color || (nodeConfig as ConfigItem).color || "#666",
          border: node.color || (nodeConfig as ConfigItem).color || "#666",
          highlight: {
            background: "#eee",
            border: node.color || (nodeConfig as ConfigItem).color || "#666",
          },
        },
        // Use circle shape for all nodes since we'll render SVGs separately
        shape: "circle",
        image: null, // Explicitly set to null to avoid loading attempts
        size: 25,
        font: {
          size: 14,
          color: "#333",
          face: "Roboto, Arial, Helvetica, sans-serif",
          strokeWidth: 2,
          strokeColor: "#fff",
        },
        borderWidth: 2,
        shadow: true,
        objectData: node,
      };
    });

    const visEdges = this.links.map((link, index) => {
      const sourceNode = this.nodes.find((n) => n.id === link.source) || { color: "#999" };
      const sourceId = typeof link.source === "string" ? link.source : String(link.source);
      const targetId = typeof link.target === "string" ? link.target : String(link.target);

      return {
        from: sourceId,
        to: targetId,
        id: `edge-${index}`,
        color: {
          color: sourceNode.color || "#999",
          highlight: "#ff0",
        },
        width: 1,
        smooth: {
          enabled: true,
          type: "continuous",
          roundness: 0.5,
          forceDirection: "none",
        },
      };
    });

    // Create vis-network data sets
    const nodes = new DataSet(visNodes);
    const edges = new DataSet(visEdges);

    // Define network options
    const options = {
      autoResize: true,
      height: `${graphHeight}px`,
      width: `${graphWidth}px`,
      nodes: {
        shape: "circle",
        // Don't use images in vis-network at all
        imagePadding: 0, // No image padding needed
        image: null, // No images
        shapeProperties: {
          useBorderWithImage: false, // Don't try to use borders with images
        },
        size: 25,
        font: {
          size: 14,
          color: "#333",
          face: "Roboto, Arial, Helvetica, sans-serif",
          strokeWidth: 2,
          strokeColor: "#fff",
        },
        borderWidth: 2,
        shadow: {
          enabled: true,
          color: "rgba(0,0,0,0.2)",
          size: 5,
        },
      },
      edges: {
        color: {
          color: "#cbd2d9",
          highlight: "#2185d0",
        },
        width: 2,
        smooth: {
          enabled: true,
          type: "continuous",
          roundness: 0.5,
          forceDirection: "none",
        },
        arrows: {
          to: { enabled: true, scaleFactor: 0.5 },
        },
      },
      physics: {
        enabled: true,
        stabilization: {
          enabled: true,
          iterations: 1000,
          updateInterval: 50,
          fit: true,
        },
        barnesHut: {
          gravitationalConstant: -1000,
          centralGravity: 0.3,
          springLength: 95,
          springConstant: 0.04,
          damping: 0.09,
          avoidOverlap: 0.1,
        },
        minVelocity: 0.75,
        maxVelocity: 30,
        solver: "barnesHut",
        timestep: 0.3,
        adaptiveTimestep: true,
      },
      interaction: {
        hover: true,
        tooltipDelay: 200,
        hideEdgesOnDrag: false,
        navigationButtons: false,
        keyboard: {
          enabled: true,
          bindToWindow: false,
        },
        zoomView: true,
      },
      layout: {
        improvedLayout: true,
        hierarchical: {
          enabled: false,
        },
      },
    };

    // Create the network instance
    try {
      this.network = new Network(container, { nodes, edges }, options);

      // Add event listeners
      this.network.on("click", this.handleNodeClick);
      this.network.on("hoverNode", this.handleNodeHover);
      this.network.on("blurNode", this.handleNodeHover);

      // Initial fit
      setTimeout(() => {
        if (this.network) {
          this.network.fit();
        }
      }, 500);
    } catch (error) {
      console.error("Error creating vis-network:", error);
    }
  }

  protected generateControllerNode(object: KubeObject) {
    let pods: Renderer.K8sApi.Pod[] = [];
    if (object instanceof Renderer.K8sApi.Deployment) {
      pods = this.getDeploymentPods(object as Renderer.K8sApi.Deployment);
    } else if (object instanceof Renderer.K8sApi.DaemonSet) {
      pods = this.getDaemonSetPods(object);
    } else if (object instanceof Renderer.K8sApi.StatefulSet) {
      pods = this.getStatefulSetPods(object);
    }

    this.getControllerChartNode(object, pods);
    this.generateServices(pods);
  }

  protected getDeploymentPods(deployment: Renderer.K8sApi.Deployment) {
    const { deploymentStore } = this;
    return deploymentStore.getChildPods(deployment);
  }

  protected getDaemonSetPods(daemonset: Renderer.K8sApi.DaemonSet) {
    const { daemonsetStore } = this;
    return daemonsetStore.getChildPods(daemonset);
  }

  protected getStatefulSetPods(statefulset: Renderer.K8sApi.StatefulSet) {
    const { statefulsetStore } = this;
    return statefulsetStore.getChildPods(statefulset);
  }

  protected generateIngresses() {
    const { ingressStore } = this;
    const { namespace } = this.props.object.metadata;
    let ingressNode: ChartDataSeries;
    const ingresses = ingressStore.getAllByNs(namespace);
    for (const ingress of ingresses) {
      if (!ingress.spec.rules) continue;

      for (const rule of ingress.spec.rules) {
        if (!rule.http?.paths) continue;

        for (const path of rule.http.paths) {
          // Define a more specific type for the backend
          const backend = path.backend as {
            serviceName?: string;
            service?: { name: string };
          };

          const serviceName = backend.serviceName || backend.service?.name;
          if (serviceName) {
            const serviceNode = this.nodes
              .filter((node) => node.kind === "Service")
              .find((node) => node.object.getName() === serviceName);

            if (serviceNode) {
              if (!ingressNode) {
                ingressNode = this.getIngressNode(ingress);
              }
              this.addLink({ source: ingressNode.id, target: serviceNode.id });
            }
          }
        }
      }
    }
  }

  protected generateServices(deploymentPods: Renderer.K8sApi.Pod[]) {
    const { serviceStore } = this;
    const { namespace } = this.props.object.metadata;
    const services = serviceStore.getAllByNs(namespace);
    for (const service of services) {
      const selector = service.spec.selector;
      if (selector) {
        const pods = deploymentPods.filter((item: Renderer.K8sApi.Pod) => {
          const itemLabels = item.metadata.labels || {};
          let matches = item.getNs() === service.getNs();
          if (matches) {
            matches = Object.entries(selector).every(([key, value]) => {
              return itemLabels[key] === value;
            });
          }
          return matches;
        });
        if (pods.length) {
          const serviceNode = this.generateNode(service);
          for (const pod of pods) {
            const podNode = this.findNode(pod);
            if (podNode) {
              const serviceLink = { source: podNode.id, target: serviceNode.id };
              this.addLink(serviceLink);
            }
          }
        }
      }
    }
  }

  protected addLink(link: LinkObject) {
    const linkExists = this.findLink(link);

    if (!linkExists) {
      this.links.push(link);
    }
  }

  protected findLink(link: LinkObject) {
    return this.links.find(
      (existingLink) =>
        (existingLink.source === link.source ||
          (existingLink.source as NodeObject).id === link.source) &&
        (existingLink.target === link.target ||
          (existingLink.target as NodeObject).id === link.target),
    );
  }

  protected findNode(object: Renderer.K8sApi.KubeObject) {
    if (!object) {
      return null;
    }

    return this.nodes.find(
      (node) =>
        node.kind === object.kind &&
        node.namespace &&
        object.getNs() &&
        node.name === object.getName(),
    );
  }

  protected deleteNode(opts: { node?: ChartDataSeries; object?: Renderer.K8sApi.KubeObject }) {
    const node = opts.node || this.findNode(opts.object);

    if (!node) {
      return;
    }

    for (const link of this.getLinksForNode(node)) {
      this.links.splice(this.links.indexOf(link), 1);
    }

    this.nodes.splice(this.nodes.indexOf(node), 1);
  }

  generateNode(object: Renderer.K8sApi.KubeObject): ChartDataSeries {
    const existingNode = this.findNode(object);

    if (existingNode) {
      return existingNode;
    }

    const id = `${object.kind}-${object.getName()}`;
    const kind = object.kind.toLowerCase();
    const nodeConfig = (this.config[kind] as ConfigItem) || {
      color: "#999",
      size: 5,
      icon: undefined,
    };

    const chartNode: ChartDataSeries = {
      id: id,
      object: object,
      kind: object.kind,
      name: object.getName(),
      namespace: object.getNs(),
      value: nodeConfig.size,
      color: nodeConfig.color,
      // Only use React component when icon is not a string
      icon: typeof nodeConfig.icon === "string" ? undefined : nodeConfig.icon,
      visible: true,
    };

    this.nodes.push(chartNode);

    return chartNode;
  }

  getControllerChartNode(
    object: Renderer.K8sApi.KubeObject,
    pods: Renderer.K8sApi.Pod[],
    podLinks = true,
  ): ChartDataSeries {
    const controllerNode = this.generateNode(object);
    controllerNode.object = object;
    for (const pod of pods) {
      const podNode = this.getPodNode(pod, podLinks);
      this.addLink({ source: controllerNode.id, target: podNode.id });
    }
    const releaseName = this.getHelmReleaseName(object);

    if (releaseName) {
      const release = this.getHelmReleaseChartNode(releaseName, object.getNs());
      this.addLink({ target: release.id, source: controllerNode.id });
    }
    return controllerNode;
  }

  getHelmReleaseName(object: Renderer.K8sApi.KubeObject): string {
    if (object.metadata?.labels?.heritage === "Helm" && object.metadata?.labels?.release) {
      return object.metadata.labels.release;
    }
    if (
      object.metadata?.labels &&
      object.metadata?.annotations &&
      object.metadata?.labels["app.kubernetes.io/managed-by"] === "Helm" &&
      object.metadata?.annotations["meta.helm.sh/release-name"]
    ) {
      return object.metadata.annotations["meta.helm.sh/release-name"];
    }
    return null;
  }

  getIngressNode(ingress: Renderer.K8sApi.Ingress) {
    const ingressNode = this.generateNode(ingress);

    const filteredTls = ingress.spec.tls?.filter((tls) => tls.secretName) || [];
    for (const tls of filteredTls) {
      const secret = this.secretStore.getByName(tls.secretName, ingress.getNs());
      if (secret) {
        const secretNode = this.generateNode(secret);
        if (secretNode) {
          this.addLink({ source: ingressNode.id, target: secretNode.id });
        }
      }
    }

    return ingressNode;
  }

  getPodNode(pod: Renderer.K8sApi.Pod, links = true): ChartDataSeries {
    const podNode = this.generateNode(pod);
    podNode.object = pod;
    if (["Running", "Succeeded"].includes(pod.getStatusMessage())) {
      podNode.color = "#4caf50";
    } else if (["Terminating", "Terminated", "Completed"].includes(pod.getStatusMessage())) {
      podNode.color = "#9dabb5";
    } else if (["Pending", "ContainerCreating"].includes(pod.getStatusMessage())) {
      podNode.color = "#2F4F4F"; // #ff9800"
    } else if (["CrashLoopBackOff", "Failed", "Error"].includes(pod.getStatusMessage())) {
      podNode.color = "#ce3933";
    }

    if (!links) {
      return podNode;
    }

    for (const container of pod.getContainers()) {
      if (container.env) {
        for (const env of container.env) {
          const secretName = env.valueFrom?.secretKeyRef?.name;
          if (secretName) {
            const secret = this.secretStore.getByName(secretName, pod.getNs());
            if (secret) {
              const secretNode = this.generateNode(secret);
              this.addLink({
                source: podNode.id,
                target: secretNode.id,
              });
            }
          }
        }
      }

      if (container.envFrom) {
        for (const envFrom of container.envFrom) {
          const configMapName = envFrom.configMapRef?.name;
          if (configMapName) {
            const configMap = this.configMapStore.getByName(configMapName, pod.getNs());
            if (configMap) {
              const configMapNode = this.generateNode(configMap);
              this.addLink({
                source: podNode.id,
                target: configMapNode.id,
              });
            }
          }

          const secretName = envFrom.secretRef?.name;
          if (secretName) {
            const secret = this.secretStore.getByName(secretName, pod.getNs());
            if (secret) {
              const secretNode = this.generateNode(secret);
              this.addLink({
                source: podNode.id,
                target: secretNode.id,
              });
            }
          }
        }
      }
    }

    const pvcVolumes = pod.getVolumes().filter((volume) => volume.persistentVolumeClaim?.claimName);
    for (const volume of pvcVolumes) {
      const volumeClaim = this.pvcStore.getByName(
        volume.persistentVolumeClaim.claimName,
        pod.getNs(),
      );
      if (volumeClaim) {
        const volumeClaimNode = this.generateNode(volumeClaim);

        if (volumeClaimNode) {
          this.addLink({ target: podNode.id, source: volumeClaimNode.id });
        }
      }
    }

    const configMapVolumes = pod.getVolumes().filter((volume) => volume.configMap?.name);
    for (const volume of configMapVolumes) {
      const configMap = this.configMapStore.getByName(volume.configMap.name, pod.getNs());
      if (configMap) {
        const dataItem = this.generateNode(configMap);
        if (dataItem) {
          this.addLink({ target: podNode.id, source: dataItem.id });
        }
      }
    }

    for (const secretName of pod.getSecrets()) {
      const secret = this.secretStore.getByName(secretName, pod.getNs());
      if (secret) {
        const dataItem = this.generateNode(secret);
        if (dataItem) {
          this.addLink({ target: podNode.id, source: dataItem.id });
        }
      }
    }

    return podNode;
  }

  getHelmReleaseChartNode(name: string, namespace: string): ChartDataSeries {
    const releaseObject = new Renderer.K8sApi.KubeObject({
      apiVersion: "v1",
      kind: "HelmRelease",
      metadata: {
        uid: "",
        namespace: namespace,
        name: name,
        resourceVersion: "1",
        selfLink: `api/v1/helmreleases/${name}`,
      },
    });
    const releaseData = this.generateNode(releaseObject);
    return releaseData;
  }

  renderTooltip(obj: Renderer.K8sApi.KubeObject) {
    if (!obj) return;

    const tooltipElement = document.getElementById("KubeForceChart-tooltip");

    if (tooltipElement) {
      if (obj instanceof Renderer.K8sApi.Pod) {
        ReactDOM.render(<PodTooltip obj={obj} />, tooltipElement);
      } else if (obj instanceof Renderer.K8sApi.Service) {
        ReactDOM.render(<ServiceTooltip obj={obj} />, tooltipElement);
      } else if (obj instanceof Renderer.K8sApi.Deployment) {
        ReactDOM.render(<DeploymentTooltip obj={obj} />, tooltipElement);
      } else if (obj instanceof Renderer.K8sApi.StatefulSet) {
        ReactDOM.render(<StatefulsetTooltip obj={obj} />, tooltipElement);
      } else if (obj instanceof Renderer.K8sApi.Ingress) {
        ReactDOM.render(<IngressTooltip obj={obj} />, tooltipElement);
      } else {
        ReactDOM.render(<DefaultTooltip obj={obj} />, tooltipElement);
      }
      return tooltipElement.innerHTML;
    }
  }

  render() {
    if (!KubeResourceChart.isReady) {
      return <Renderer.Component.Spinner />;
    }

    const { id } = this.props;

    return (
      <div id={id} className="KubeForceChart flex column">
        <div id="KubeForceChart-tooltip" />
        <Renderer.Component.DrawerTitle title="Resources" />

        {this.state.showTooltipForObject && (
          <div style={{ display: "none" }}>
            {this.renderTooltip(this.state.showTooltipForObject)}
          </div>
        )}

        <div
          id={`${id}-network`}
          ref={this.networkContainer}
          style={{ width: "100%", height: "400px" }}
        />
      </div>
    );
  }
}
