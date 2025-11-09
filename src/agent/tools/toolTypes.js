export function defineTool({ name, description, actions = {}, metadata = {} }) {
  if (!name || typeof name !== "string") {
    throw new Error("Tool name must be a non-empty string.");
  }

  if (description && typeof description !== "string") {
    throw new Error("Tool description must be a string if provided.");
  }

  if (!actions || typeof actions !== "object") {
    throw new Error("Tool actions must be provided as an object map.");
  }

  const normalizedActions = {};
  for (const [actionName, fn] of Object.entries(actions)) {
    if (typeof fn !== "function") {
      throw new Error(`Action '${actionName}' for tool '${name}' must be a function.`);
    }
    normalizedActions[actionName] = fn;
  }

  return Object.freeze({
    name,
    description: description ?? "",
    actions: Object.freeze(normalizedActions),
    metadata: Object.freeze({ ...metadata }),
  });
}

export function createToolInvoker(tool) {
  if (!tool || typeof tool !== "object") {
    throw new Error("createToolInvoker requires a valid tool definition.");
  }

  return function invoke(actionName, payload) {
    const action = tool.actions[actionName];
    if (!action) {
      throw new Error(`Tool '${tool.name}' does not provide action '${actionName}'.`);
    }
    return action(payload);
  };
}
