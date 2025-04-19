import type { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { KubeResourceChart } from "./KubeResourceChart";

@observer
export class KubeServiceChart extends KubeResourceChart {
  registerStores() {
    this.kubeObjectStores = [
      this.podsStore,
      this.serviceStore,
      this.ingressStore,
      this.pvcStore,
      this.configMapStore,
      this.secretStore,
      this.deploymentStore,
      this.daemonsetStore,
      this.statefulsetStore,
    ];
  }

  generateChartDataSeries = () => {
    const nodes = [...this.nodes];
    const links = [...this.links];

    //this.generateControllerNode();
    const { object: service } = this.props;
    const selector = (service as Renderer.K8sApi.Service).spec.selector;

    this.generateNode(service);

    if (selector) {
      const filteredPods = this.podsStore
        .getAllByNs(service.getNs())
        .filter((item: Renderer.K8sApi.Pod) => {
          const itemLabels = item.metadata.labels || {};
          return Object.entries(selector).every(([key, value]) => {
            return itemLabels[key] === value;
          });
        });

      for (const pod of filteredPods) {
        this.generatePodNode(pod);
      }
    }

    this.generateIngresses();

    if (nodes.length !== this.nodes.length || links.length !== this.links.length) {
      // TODO: Improve the logic
      this.updateState(this.nodes, this.links);
    }
  };

  protected generateIngresses() {
    const { ingressStore } = this;
    const { object: service } = this.props;

    const ingresses = ingressStore.getAllByNs(service.getNs());
    for (const ingress of ingresses) {
      for (const rule of ingress.spec.rules) {
        if (rule.http?.paths) {
          for (const path of rule.http.paths) {
            // Define a more specific type for the backend
            const backend = path.backend as {
              serviceName?: string;
              service?: { name: string };
            };

            if (
              backend.serviceName === service.getName() ||
              backend.service?.name === service.getName()
            ) {
              const serviceNode = this.generateNode(service);
              const ingressNode = this.getIngressNode(ingress);
              this.addLink({ source: ingressNode.id, target: serviceNode.id });
            }
          }
        }
      }
    }
  }

  protected generatePodNode(pod: Renderer.K8sApi.Pod) {
    this.getPodNode(pod, false);
    this.generateServices([pod]);

    const controller = this.getControllerObject(pod);

    if (controller) {
      this.getControllerChartNode(controller, [pod], false);
    }
  }

  getControllerObject(pod: Renderer.K8sApi.Pod) {
    if (pod.getOwnerRefs()[0]?.kind === "StatefulSet") {
      return this.statefulsetStore.getByName(pod.getOwnerRefs()[0].name, pod.getNs());
    }

    if (pod.getOwnerRefs()[0]?.kind === "DaemonSet") {
      return this.daemonsetStore.getByName(pod.getOwnerRefs()[0].name, pod.getNs());
    }
    return this.deploymentStore.items.find((deployment: Renderer.K8sApi.Deployment) =>
      deployment.getSelectors().every((label: string) => pod.getLabels().includes(label)),
    );
  }
}
