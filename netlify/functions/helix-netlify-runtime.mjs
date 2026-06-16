import { connectLambda } from '@netlify/blobs';

export function connectHelixNetlifyRuntime(event) {
  if (event?.blobs) {
    connectLambda(event);
  }
}
