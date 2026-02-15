// StandardErrorHandler stub for LocalModelManager
export const standardErrorHandler = {
  handleError: function(error, context) {
    var handled = new Error(error.message || 'handled error');
    handled.context = context;
    return handled;
  },
};
