import "./KubeForceChart.scss";
import { Renderer } from "@freelensapp/extensions";
import { makeObservable, observable, reaction } from "mobx";
import { disposeOnUnmount, observer } from "mobx-react";
import React from "react";
import ReactDOM from "react-dom";
import { Network } from "vis-network";
import { DataSet } from "vis-data";
import {
  PodTooltip,
  ServiceTooltip,
  DeploymentTooltip,
  StatefulsetTooltip,
  DefaultTooltip,
} from "./tooltips";
import type { ChartDataSeries, LinkObject } from "./helpers/types";
import { config, type ConfigItem } from "./helpers/config";

export interface KubeForceChartProps {
  id?: string;
  width?: number;
  height?: number;
  widthRef?: string;
}

interface State {
  nodes: ChartDataSeries[];
  edges: LinkObject[];
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
export class KubeForceChart extends React.Component<KubeForceChartProps, State> {
  @observable static isReady = false;
  @observable isUnmounting = false;

  static defaultProps: KubeForceChartProps = {
    id: "kube-resources-map",
  };

  static config = config;

  protected links: LinkObject[] = [];
  protected nodes: ChartDataSeries[] = [];
  protected network: Network | null = null;
  protected config = KubeForceChart.config;
  protected images: { [key: string]: HTMLImageElement } = {};
  private _clickTimeout: NodeJS.Timeout | null = null;
  private _stabilizationTimeout: NodeJS.Timeout | null = null;
  private _lastNetworkUpdate: number = 0;

  protected namespaceStore = Renderer.K8sApi.apiManager.getStore(
    Renderer.K8sApi.namespacesApi,
  ) as unknown as Renderer.K8sApi.NamespaceStore;
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

  private kubeObjectStores: Renderer.K8sApi.KubeObjectStore[] = [];
  private watchDisposers: (() => void)[] = [];
  private networkContainer = React.createRef<HTMLDivElement>();

  state: State = {
    nodes: [],
    edges: [],
  };

  constructor(props: KubeForceChartProps) {
    super(props);
    makeObservable(this);
  }

  async componentDidMount() {
    this.kubeObjectStores = [
      this.podsStore,
      this.deploymentStore,
      this.statefulsetStore,
      this.daemonsetStore,
      this.serviceStore,
      this.ingressStore,
      this.pvcStore,
      this.configMapStore,
      this.secretStore,
    ];

    await this.loadData();
    this.displayChart();

    // Initialize network visualization after data is loaded
    setTimeout(() => {
      if (KubeForceChart.isReady && this.nodes.length > 0) {
        this.updateNetwork();
      }
    }, 100);

    disposeOnUnmount(this, [
      // React to namespace changes with an extremely robust approach
      reaction(
        () => {
          try {
            // Handle potential null/undefined cases
            if (!this.namespaceStore?.selectedNamespaces) {
              return [];
            }
            // Make a deep copy to avoid reference issues
            return Array.isArray(this.namespaceStore.selectedNamespaces)
              ? [...this.namespaceStore.selectedNamespaces]
              : [];
          } catch (e) {
            console.error("Error in namespace reaction getter:", e);
            return [];
          }
        },
        (namespaces, prevNamespaces) => {
          try {
            console.log(
              "Namespace selection changed:",
              JSON.stringify(namespaces),
              "Previous:",
              JSON.stringify(prevNamespaces),
            );
            this.namespaceChanged();
          } catch (e) {
            console.error("Error in namespace reaction effect:", e);
          }
        },
        {
          fireImmediately: true,
          equals: (a, b) => {
            if (!Array.isArray(a) || !Array.isArray(b)) return false;
            if (a.length !== b.length) return false;
            return a.every((item) => b.includes(item));
          },
        },
      ),

      // React to store changes
      reaction(
        () => this.podsStore.items.toJSON(),
        () => {
          this.refreshItems(this.podsStore);
        },
      ),
      reaction(
        () => this.daemonsetStore.items.toJSON(),
        () => {
          this.refreshItems(this.daemonsetStore);
        },
      ),
      reaction(
        () => this.statefulsetStore.items.toJSON(),
        () => {
          this.refreshItems(this.statefulsetStore);
        },
      ),
      reaction(
        () => this.deploymentStore.items.toJSON(),
        () => {
          this.refreshItems(this.deploymentStore);
        },
      ),
      reaction(
        () => this.serviceStore.items.toJSON(),
        () => {
          this.refreshItems(this.serviceStore);
        },
      ),
      reaction(
        () => this.secretStore.items.toJSON(),
        () => {
          this.refreshItems(this.secretStore);
        },
      ),
      reaction(
        () => this.pvcStore.items.toJSON(),
        () => {
          this.refreshItems(this.pvcStore);
        },
      ),
      reaction(
        () => this.ingressStore.items.toJSON(),
        () => {
          this.refreshItems(this.ingressStore);
        },
      ),
      reaction(
        () => this.configMapStore.items.toJSON(),
        () => {
          this.refreshItems(this.configMapStore);
        },
      ),
    ]);
  }

  // Helper method to check if an object should be included based on namespace filter
  protected shouldIncludeBasedOnNamespace(namespace: string): boolean {
    try {
      const { selectedNamespaces } = this.namespaceStore;

      // If no namespace is selected, show all
      if (!selectedNamespaces || selectedNamespaces.length === 0) {
        return true;
      }

      // Otherwise, strictly filter by selected namespaces
      return selectedNamespaces.includes(namespace);
    } catch (error) {
      console.error("Error checking namespace:", error);
      return true; // Include by default if there's an error
    }
  }

  // Filter a list of resources by namespace
  protected filterByNamespace<T extends Renderer.K8sApi.KubeObject>(
    items: T[],
    getNs: (item: T) => string = (item) => item.getNs(),
  ): T[] {
    try {
      const { selectedNamespaces } = this.namespaceStore;
      console.log("Filtering by namespaces:", selectedNamespaces);

      // If no namespace is selected, show all
      if (!selectedNamespaces || selectedNamespaces.length === 0) {
        return items;
      }

      // Filter items by selected namespaces
      return items.filter((item) => {
        try {
          const itemNs = getNs(item);
          return selectedNamespaces.includes(itemNs);
        } catch (err) {
          console.warn("Error getting namespace for item:", item, err);
          return false;
        }
      });
    } catch (error) {
      console.error("Error filtering by namespace:", error);
      return items; // Return all items if there's an error
    }
  }

  componentDidUpdate() {
    // Only create or update the network if we have nodes to display
    if (KubeForceChart.isReady && this.nodes.length > 0) {
      this.updateNetwork();
    }
  }

  componentWillUnmount() {
    this.isUnmounting = true;
    this.unsubscribeStores();

    // Clean up the network
    if (this.network) {
      this.network.destroy();
      this.network = null;
    }
  }

  namespaceChanged = () => {
    if (!KubeForceChart.isReady) return;

    try {
      console.log(
        "Namespace changed, reloading chart with selected namespaces:",
        Array.isArray(this.namespaceStore.selectedNamespaces)
          ? [...this.namespaceStore.selectedNamespaces]
          : "none",
      );

      // Completely clean everything
      this.nodes = [];
      this.links = [];

      // Update state to clear the UI
      this.setState({ nodes: [], edges: [] });

      // Completely destroy the old network
      if (this.network) {
        try {
          this.network.destroy();
        } catch (e) {
          console.error("Error destroying network:", e);
        }
        this.network = null;
      }

      // Short delay to ensure everything is cleaned up
      setTimeout(() => {
        // Generate completely new chart data
        this.displayChart();

        // Update visualization with a delay to ensure data is processed
        setTimeout(() => {
          if (this.network) {
            // Force a fit with no animation
            try {
              this.network.fit({
                animation: false,
              });
            } catch (e) {
              console.error("Error fitting network:", e);
            }
          }
        }, 500);
      }, 100);
    } catch (e) {
      console.error("Error in namespaceChanged:", e);
    }
  };

  displayChart = () => {
    this.nodes = [];
    this.links = [];
    this.generateChartDataSeries();
    this.setState({ nodes: this.nodes, edges: this.links });

    // Update the network with filtered data
    setTimeout(() => {
      if (KubeForceChart.isReady && this.nodes.length > 0) {
        this.updateNetwork();
      }
    }, 100);
  };

  // SVG icons are now imported as React components
  // No need to preload images

  protected refreshItems(store: Renderer.K8sApi.KubeObjectStore) {
    // remove deleted objects
    const nodesOfKind = this.nodes.filter((node) => node.kind === store.api.kind);
    for (const node of nodesOfKind) {
      if (!store.items.includes(node.object as Renderer.K8sApi.KubeObject)) {
        if (["DaemonSet", "StatefulSet", "Deployment"].includes(node.kind)) {
          const helmReleaseName = this.getHelmReleaseName(node.object);
          if (helmReleaseName) {
            const helmReleaseNode = this.getHelmReleaseChartNode(helmReleaseName, node.namespace);
            if (this.getLinksForNode(helmReleaseNode).length === 1) {
              this.deleteNode({ node: helmReleaseNode });
            }
          }
        }
        this.deleteNode(node);
      }
    }
    this.generateChartDataSeries();

    // Update the network visualization after data refresh
    setTimeout(() => {
      if (KubeForceChart.isReady && this.nodes.length > 0) {
        this.updateNetwork();
      }
    }, 100);
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
        const unsubscribe = store.subscribe();
        this.watchDisposers.push(unsubscribe);
      } catch (error) {
        console.error("loading store error", error);
      }
    }
    KubeForceChart.isReady = true;
  }

  generateChartDataSeries = () => {
    const oldNodeCount = this.nodes.length;
    const oldLinkCount = this.links.length;

    this.generateSecrets();
    this.generateVolumeClaims();
    this.generateDeployments();
    this.generateStatefulSets();
    this.generateDaemonSets();
    this.generatePods();
    this.generateServices();
    this.generateIngresses();

    // Only update state if the data has changed
    if (oldNodeCount !== this.nodes.length || oldLinkCount !== this.links.length) {
      this.setState({ nodes: this.nodes, edges: this.links });
    }
  };

  updateNetwork() {
    const { id, width, height } = this.props;
    const container = document.getElementById(`${id}-network`);
    if (!container) return;

    // Get proper sidebar width, use safe fallback if not found
    const sidebar = document.querySelector('[data-testid="cluster-sidebar"]') as HTMLElement;
    const sidebarWidth = sidebar?.offsetWidth || 200;

    // Calculate dimensions, leaving room for header and filter
    const graphWidth = width || window.innerWidth - 70 - sidebarWidth;
    const graphHeight = height || window.innerHeight - 200; // Increased to allow space for header

    // Destroy existing network if any
    if (this.network) {
      this.network.destroy();
      this.network = null;
    }

    // Convert the nodes and links to vis-network format
    const visNodes = this.nodes.map((node) => {
      const kind = node.kind.toLowerCase();
      const nodeConfig = (this.config[kind] as ConfigItem) || {
        color: "#666",
        size: 20,
        icon: undefined,
      };

      // Determine shape based on whether a valid image is available
      const hasValidImage = typeof nodeConfig.icon === "string";
      const shape = hasValidImage ? "circularImage" : "ellipse";
      
      // Use appropriate shape for K8s resources
      return {
        id: node.id,
        label: node.name,
        color: {
          background: node.color || nodeConfig.color || "#666",
          border: node.color || nodeConfig.color || "#666",
          highlight: {
            background: node.color || nodeConfig.color || "#666",
            border: node.color || nodeConfig.color || "#666",
          },
        },
        shape: shape,
        // Only use string URLs for vis-network images, React components are not supported here
        image: hasValidImage ? nodeConfig.icon as string : undefined,
        size: 25,
        font: {
          size: 14,
          color: "#000",
          face: "Roboto, Arial, Helvetica, sans-serif",
          strokeWidth: 3,
          strokeColor: "#fff",
          vadjust: -25, // Move label further away from node
        },
        borderWidth: 1,
        shadow: false,
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
        shape: "circularImage",
        size: 25,
        font: {
          size: 14,
          color: "#000",
          face: "Roboto, Arial, Helvetica, sans-serif",
          strokeWidth: 3,
          strokeColor: "#fff",
          vadjust: -25,
        },
        borderWidth: 1,
        shadow: {
          enabled: false,
        },
        shapeProperties: {
          useBorderWithImage: true,
          interpolation: false,
        },
        brokenImage: undefined,
        margin: {
          top: 10,
          bottom: 10,
        },
        scaling: {
          min: 20,
          max: 35,
          label: {
            enabled: true,
            min: 14,
            max: 18,
          },
        },
      },
      edges: {
        color: {
          color: "#cbd2d9",
          highlight: "#cbd2d9", // Same as normal color to avoid highlighting
        },
        width: 1,
        smooth: {
          enabled: true,
          type: "straightCross", // Simpler edge routing
          roundness: 0.2, // Less curvature
          forceDirection: "none",
        },
        arrows: {
          to: { enabled: true, scaleFactor: 0.3 },
        },
        physics: true,
        selectionWidth: 0, // No edge width change on selection
      },
      physics: {
        enabled: true, // Enable physics for initial positioning
        stabilization: {
          enabled: true,
          iterations: 500, // More iterations for better initial stability
          updateInterval: 50,
          fit: true,
        },
        barnesHut: {
          gravitationalConstant: -2000, // Good repulsion between nodes
          centralGravity: 0.1, // Balanced central gravity
          springLength: 120, // Good spring length for spacing
          springConstant: 0.04, // Balanced spring stiffness
          damping: 0.3, // Increased damping to reduce oscillations
          avoidOverlap: 0.5, // Prevent node overlap
        },
        solver: "barnesHut",
        timestep: 0.5, // Larger timestep for faster convergence
        adaptiveTimestep: true, // Use adaptive time stepping
        minVelocity: 1.0, // Higher threshold to settle nodes faster
        maxVelocity: 30, // Limit maximum velocity
      },
      interaction: {
        hover: false, // Disable hover effects
        tooltipDelay: 0,
        hideEdgesOnDrag: false,
        navigationButtons: false,
        keyboard: {
          enabled: true,
          bindToWindow: false,
        },
        zoomView: true,
        hoverConnectedEdges: false, // Disable edge highlighting on hover
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

      // No need to track positions for SVG rendering

      // Update stabilization options and track zoom events
      this.network.setOptions({
        physics: {
          stabilization: {
            enabled: true,
            iterations: 500,
            updateInterval: 25,
            fit: true,
            onlyDynamicEdges: false,
          },
        },
      });
      
      // Add zoom and pan handlers 
      this.network.on("zoom", () => {
        // Throttle updates by directly updating when network changes
        if (this.network) {
          const scale = this.network.getScale();
          const position = this.network.getViewPosition();
          console.log(`View updated: scale=${scale.toFixed(2)}, position=(${position.x.toFixed(0)},${position.y.toFixed(0)})`);
        }
      });
      
      this.network.on("dragEnd", () => {
        // Update on drag end to capture final position
        if (this.network) {
          const position = this.network.getViewPosition();
          console.log(`View updated: position=(${position.x.toFixed(0)},${position.y.toFixed(0)})`);
        }
      });

      // Let physics handle the initial layout

      // Set safety timeout to disable physics if stabilization takes too long
      if (this._stabilizationTimeout) {
        clearTimeout(this._stabilizationTimeout);
      }
      
      this._stabilizationTimeout = setTimeout(() => {
        if (this.network) {
          console.log("Stabilization safety timeout - fixing layout");
          this.network.setOptions({ physics: { enabled: false } });
          this.network.fit();
        }
      }, 5000);
      
      // Stabilize once and disable physics
      this.network.once("stabilized", () => {
        console.log("Network stabilized");
        
        // Clear the safety timeout since we stabilized successfully
        if (this._stabilizationTimeout) {
          clearTimeout(this._stabilizationTimeout);
          this._stabilizationTimeout = null;
        }
        
        // Disable physics after stabilization for a fixed layout
        this.network.setOptions({ physics: { enabled: false } });
      });

      // Initial fit with no animation
      setTimeout(() => {
        if (this.network) {
          console.log("Fitting network view");
          try {
            this.network.fit({
              animation: false,
            });
          } catch (e) {
            console.error("Error fitting view:", e);
          }
        }
      }, 100);
    } catch (error) {
      console.error("Error creating vis-network:", error);
    }
  }

  getLinksForNode(node: ChartDataSeries): LinkObject[] {
    return this.links.filter((link) => link.source === node.id || link.target === node.id);
  }

  handleNodeClick = (params: { nodes?: string[] }) => {
    // Prevent quick double clicks
    if (this._clickTimeout) {
      clearTimeout(this._clickTimeout);
      this._clickTimeout = null;
      return;
    }

    this._clickTimeout = setTimeout(() => {
      this._clickTimeout = null;

      if (params.nodes && params.nodes.length > 0) {
        const nodeId = params.nodes[0];
        const node = this.nodes.find((n) => n.id === nodeId);

        if (node?.object) {
          const object = node.object;
          console.log("Clicked node:", node.id, object.kind, object.getName());

          try {
            if (object.kind === "HelmRelease") {
              const path = `/apps/releases/${object.getNs()}/${object.getName()}?`;
              Renderer.Navigation.navigate(path);
            } else {
              const detailsUrl = Renderer.Navigation.getDetailsUrl(object.selfLink);
              Renderer.Navigation.navigate(detailsUrl);
            }
          } catch (error) {
            console.error("Error navigating to node details:", error);
          }
        }
      }
    }, 300);
  };

  handleNodeHover = (params: { node?: string }) => {
    if (params.node) {
      const nodeId = params.node;
      const node = this.nodes.find((n) => n.id === nodeId);

      if (node?.object) {
        this.setState({
          hoverNode: nodeId,
          showTooltipForObject: node.object,
        });
      }
    } else {
      this.setState({
        hoverNode: undefined,
        showTooltipForObject: undefined,
      });
    }
  };

  // We're using vis-network's built-in image handling now

  // Helper methods
  protected addLink(link: { source: string; target: string }) {
    const linkExists = this.links.find(
      (l) =>
        (l.source === link.source && l.target === link.target) ||
        (l.source === link.target && l.target === link.source),
    );

    if (!linkExists) {
      this.links.push(link as LinkObject);
    }
  }

  protected findNode(object: Renderer.K8sApi.KubeObject) {
    if (!object) {
      return null;
    }
    return this.nodes.find(
      (node) =>
        node.kind === object.kind &&
        node.namespace === object.getNs() &&
        node.name === object.getName(),
    );
  }

  protected deleteNode(opts: { node?: ChartDataSeries; object?: Renderer.K8sApi.KubeObject }) {
    const nodeToDelete = opts.node || (opts.object ? this.findNode(opts.object) : undefined);
    if (!nodeToDelete) {
      return;
    }

    // Remove all links connected to this node
    this.links = this.links.filter(
      (link) => link.source !== nodeToDelete.id && link.target !== nodeToDelete.id,
    );

    // Remove the node itself
    const index = this.nodes.indexOf(nodeToDelete);
    if (index !== -1) {
      this.nodes.splice(index, 1);
    }
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

    // Handle icon type - only use React.ComponentType when the icon is not a string
    // This ensures ChartDataSeries type is satisfied with React.ComponentType<React.SVGProps<SVGSVGElement>>
    const icon = typeof nodeConfig.icon === "string" ? undefined : nodeConfig.icon;

    const chartNode: ChartDataSeries = {
      id,
      object,
      kind: object.kind,
      name: object.getName(),
      namespace: object.getNs(),
      value: nodeConfig.size || 5,
      color: nodeConfig.color || "#999",
      icon,
      visible: true,
    };

    this.nodes.push(chartNode);
    return chartNode;
  }

  getControllerChartNode(
    object: Renderer.K8sApi.KubeObject,
    pods: Renderer.K8sApi.Pod[],
  ): ChartDataSeries {
    const controllerNode = this.generateNode(object);

    for (const pod of pods) {
      const podNode = this.getPodNode(pod);
      this.addLink({ source: controllerNode.id, target: podNode.id });
    }

    const releaseName = this.getHelmReleaseName(object);
    if (releaseName) {
      const release = this.getHelmReleaseChartNode(releaseName, object.getNs());
      this.addLink({ target: release.id, source: controllerNode.id });
    }

    return controllerNode;
  }

  getHelmReleaseName(object: Renderer.K8sApi.KubeObject): string | null {
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

  getPodNode(pod: Renderer.K8sApi.Pod): ChartDataSeries {
    const podNode = this.generateNode(pod);

    // Set color based on pod status
    if (["Running", "Succeeded"].includes(pod.getStatusMessage())) {
      podNode.color = "#4caf50"; // Green for healthy pods
    } else if (["Terminating", "Terminated", "Completed"].includes(pod.getStatusMessage())) {
      podNode.color = "#9dabb5"; // Gray for terminated pods
    } else if (["Pending", "ContainerCreating"].includes(pod.getStatusMessage())) {
      podNode.color = "#2F4F4F"; // Darker gray for pending
    } else if (["CrashLoopBackOff", "Failed", "Error"].includes(pod.getStatusMessage())) {
      podNode.color = "#ce3933"; // Red for error states
    }

    // Process pod containers for environment variables and volumes
    for (const container of pod.getContainers()) {
      // Process environment variables
      if (container.env) {
        for (const env of container.env) {
          const secretName = env.valueFrom?.secretKeyRef?.name;
          if (secretName) {
            const secret = this.secretStore.getByName(secretName, pod.getNs());
            if (secret) {
              const secretNode = this.generateNode(secret);
              this.addLink({ source: podNode.id, target: secretNode.id });
            }
          }
        }
      }

      // Process envFrom sources
      if (container.envFrom) {
        for (const envFrom of container.envFrom) {
          const configMapName = envFrom.configMapRef?.name;
          if (configMapName) {
            const configMap = this.configMapStore.getByName(configMapName, pod.getNs());
            if (configMap) {
              const configMapNode = this.generateNode(configMap);
              this.addLink({ source: podNode.id, target: configMapNode.id });
            }
          }

          const secretName = envFrom.secretRef?.name;
          if (secretName) {
            const secret = this.secretStore.getByName(secretName, pod.getNs());
            if (secret) {
              const secretNode = this.generateNode(secret);
              this.addLink({ source: podNode.id, target: secretNode.id });
            }
          }
        }
      }
    }

    // Process persistent volume claims
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

    // Process configMap volumes
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

    // Process secrets used by the pod
    for (const secretName of pod.getSecrets()) {
      const secret = this.secretStore.getByName(secretName, pod.getNs());
      if (secret && secret.type.toString() !== "kubernetes.io/service-account-token") {
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
    return this.generateNode(releaseObject);
  }

  renderTooltip(obj: Renderer.K8sApi.KubeObject) {
    if (!obj) return;

    const tooltipElement = document.getElementById("KubeForceChart-tooltip");
    if (!tooltipElement) return;

    // Render the appropriate tooltip component based on the object type
    if (obj instanceof Renderer.K8sApi.Pod) {
      ReactDOM.render(<PodTooltip obj={obj} />, tooltipElement);
    } else if (obj instanceof Renderer.K8sApi.Service) {
      ReactDOM.render(<ServiceTooltip obj={obj} />, tooltipElement);
    } else if (obj instanceof Renderer.K8sApi.Deployment) {
      ReactDOM.render(<DeploymentTooltip obj={obj} />, tooltipElement);
    } else if (obj instanceof Renderer.K8sApi.StatefulSet) {
      ReactDOM.render(<StatefulsetTooltip obj={obj} />, tooltipElement);
    } else {
      ReactDOM.render(<DefaultTooltip obj={obj} />, tooltipElement);
    }

    return tooltipElement.innerHTML;
  }

  // Data generation methods
  protected generatePods() {
    const { podsStore } = this;

    // Use helper method to filter by namespace
    for (const pod of this.filterByNamespace(podsStore.items)) {
      this.getPodNode(pod);
    }
  }

  protected generateDeployments() {
    const { deploymentStore } = this;

    // Use helper method to filter by namespace
    for (const deployment of this.filterByNamespace(deploymentStore.items)) {
      const pods = deploymentStore.getChildPods(deployment);
      this.getControllerChartNode(deployment, pods);
    }
  }

  protected generateStatefulSets() {
    const { statefulsetStore } = this;

    // Use helper method to filter by namespace
    for (const statefulset of this.filterByNamespace(statefulsetStore.items)) {
      const pods = statefulsetStore.getChildPods(statefulset);
      this.getControllerChartNode(statefulset, pods);
    }
  }

  protected generateDaemonSets() {
    const { daemonsetStore } = this;

    // Use helper method to filter by namespace
    for (const daemonset of this.filterByNamespace(daemonsetStore.items)) {
      const pods = daemonsetStore.getChildPods(daemonset);
      this.getControllerChartNode(daemonset, pods);
    }
  }

  protected generateSecrets() {
    const { secretStore } = this;

    // Use helper method to filter by namespace
    for (const secret of this.filterByNamespace(secretStore.items)) {
      // Ignore service account tokens and tls secrets
      if (
        ["kubernetes.io/service-account-token", "kubernetes.io/tls"].includes(
          secret.type.toString(),
        )
      )
        continue;

      const secretNode = this.generateNode(secret);

      if (secret.type.toString() === "helm.sh/release.v1") {
        const helmReleaseNode = this.getHelmReleaseChartNode(
          secret.metadata.labels.name,
          secret.getNs(),
        );
        this.addLink({ source: secretNode.id, target: helmReleaseNode.id });
      }

      // search for container links (only within the same namespace)
      const podNodes = this.nodes.filter(
        (node) => node.kind === "Pod" && node.namespace === secret.getNs(),
      );
      for (const podNode of podNodes) {
        const pod = podNode.object as Renderer.K8sApi.Pod;
        for (const container of pod.getContainers()) {
          if (container.env) {
            for (const env of container.env) {
              const secretName = env.valueFrom?.secretKeyRef?.name;
              if (secretName === secret.getName()) {
                this.addLink({
                  source: podNode.id,
                  target: secretNode.id,
                });
              }
            }
          }

          if (container.envFrom) {
            for (const envFrom of container.envFrom) {
              const secretName = envFrom.secretRef?.name;
              if (secretName && secretName === secret.getName()) {
                this.addLink({
                  source: podNode.id,
                  target: secretNode.id,
                });
              }
            }
          }
        }
      }
    }
  }

  protected generateVolumeClaims() {
    const { pvcStore } = this;

    // Use helper method to filter by namespace
    for (const pvc of this.filterByNamespace(pvcStore.items)) {
      this.generateNode(pvc);
    }
  }

  protected generateIngresses() {
    const { ingressStore } = this;

    // Use helper method to filter by namespace
    for (const ingress of this.filterByNamespace(ingressStore.items)) {
      const ingressNode = this.generateNode(ingress);

      // Process TLS secrets
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

      // Process rules and paths
      for (const rule of ingress.spec.rules) {
        if (rule.http) {
          for (const path of rule.http.paths) {
            // Define a more specific backend type instead of any
            const backend = path.backend as {
              serviceName?: string;
              service?: { name: string };
            };
            const serviceName = backend.serviceName || backend.service?.name;
            if (serviceName) {
              const service = this.serviceStore.getByName(serviceName, ingress.getNs());
              if (service) {
                const serviceNode = this.generateNode(service);
                if (serviceNode) {
                  this.addLink({ source: ingressNode.id, target: serviceNode.id });
                }
              }
            }
          }
        }
      }
    }
  }

  protected generateServices() {
    const { serviceStore, podsStore } = this;

    // Use helper method to filter by namespace
    for (const service of this.filterByNamespace(serviceStore.items)) {
      const serviceNode = this.generateNode(service);
      const selector = service.spec.selector;

      if (selector) {
        // Find matching pods by selector and namespace
        const pods = this.filterByNamespace(podsStore.items).filter((pod: Renderer.K8sApi.Pod) => {
          // Check if this pod is in the same namespace as the service
          if (pod.getNs() !== service.getNs()) return false;

          // Check if the pod's labels match the service selector
          const itemLabels = pod.metadata.labels || {};
          return Object.entries(selector).every(([key, value]) => {
            return itemLabels[key] === value;
          });
        });

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

  render() {
    if (!KubeForceChart.isReady) {
      return (
        <div className="KubeForceChart flex center">
          <Renderer.Component.Spinner />
        </div>
      );
    }

    const { id } = this.props;

    return (
      <div id={id} className="KubeForceChart">
        <div id="KubeForceChart-tooltip" />
        {this.state.showTooltipForObject && (
          <div style={{ display: "none" }}>
            {this.renderTooltip(this.state.showTooltipForObject)}
          </div>
        )}
        <div
          id={`${id}-network`}
          ref={this.networkContainer}
          style={{ width: "100%", height: "100%", position: "relative" }}
        />
      </div>
    );
  }
}
