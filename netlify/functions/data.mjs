import {
  handleHelixLambdaEvent,
  handleHelixNetlifyRequest,
} from '../../server/helix-netlify-runtime.mjs';

export default handleHelixNetlifyRequest;

// Kept for local persistence tests; Netlify uses the default Request/Response export above.
export const handleLambdaEvent = handleHelixLambdaEvent;
