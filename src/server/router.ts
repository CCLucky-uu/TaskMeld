import type { RouteHandler, Router } from "./types";

type RouteNode = {
  staticChildren: Map<string, RouteNode>;
  paramChild?: { name: string; node: RouteNode };
  wildcardChild?: { name: string; node: RouteNode };
  handlers: Map<string, RouteHandler>;
};

const createNode = (): RouteNode => ({
  staticChildren: new Map(),
  handlers: new Map(),
});

export const createRouter = (): Router => {
  const root = createNode();

  const register: Router["register"] = (method, path, handler) => {
    if (!path.startsWith("/")) {
      throw new Error(`Route path must start with "/": ${path}`);
    }

    const normalizedMethod = method.toUpperCase();
    const segments = path.split("/").slice(1);
    let current = root;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (!segment) continue;

      if (segment.startsWith("*")) {
        const name = segment.slice(1);
        if (!current.wildcardChild) {
          current.wildcardChild = { name, node: createNode() };
        }
        current = current.wildcardChild.node;
      } else if (segment.startsWith(":")) {
        const name = segment.slice(1);
        if (!current.paramChild) {
          current.paramChild = { name, node: createNode() };
        }
        current = current.paramChild.node;
      } else {
        let child = current.staticChildren.get(segment);
        if (!child) {
          child = createNode();
          current.staticChildren.set(segment, child);
        }
        current = child;
      }
    }

    if (current.handlers.has(normalizedMethod)) {
      throw new Error(`Duplicate route: ${normalizedMethod} ${path}`);
    }

    current.handlers.set(normalizedMethod, handler);
  };

  const match: Router["match"] = (method, pathname) => {
    const normalizedMethod = method.toUpperCase();
    const segments = pathname.split("/").slice(1);
    const params: Record<string, string> = {};

    const matchNode = (node: RouteNode, index: number): RouteNode | null => {
      if (index >= segments.length) {
        return node;
      }

      const segment = segments[index];

      const staticChild = node.staticChildren.get(segment);
      if (staticChild) {
        const result = matchNode(staticChild, index + 1);
        if (result) return result;
      }

      if (node.paramChild) {
        try {
          const decoded = decodeURIComponent(segment);
          const prevParam = params[node.paramChild.name];
          params[node.paramChild.name] = decoded;
          const result = matchNode(node.paramChild.node, index + 1);
          if (result) return result;
          if (prevParam === undefined) {
            delete params[node.paramChild.name];
          } else {
            params[node.paramChild.name] = prevParam;
          }
        } catch {
          return null;
        }
      }

      if (node.wildcardChild) {
        const rest = segments.slice(index).join("/");
        try {
          params[node.wildcardChild.name] = decodeURIComponent(rest);
        } catch {
          return null;
        }
        return node.wildcardChild.node;
      }

      return null;
    };

    const matchedNode = matchNode(root, 0);
    if (!matchedNode) return null;

    const handler = matchedNode.handlers.get(normalizedMethod);
    if (!handler) return null;

    return { handler, params };
  };

  return { register, match };
};
