// Chromium keeps service workers in separate network targets. Disabling only
// the page can leave their fetches online, so exercise both browser boundaries.
export async function setBrowserOffline(context, origin) {
  await context.setOffline(true);
  const session = await context.browser().newBrowserCDPSession();
  const { targetInfos } = await session.send('Target.getTargets');
  for (const target of targetInfos.filter(t => t.type === 'service_worker' && t.url.startsWith(`${origin}/`))) {
    const { sessionId } = await session.send('Target.attachToTarget', { targetId: target.targetId, flatten: false });
    let sequence = 0;
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { session.off('Target.receivedMessageFromTarget', handler); reject(new Error('Worker offline setup timed out')); }, 5000);
      const handler = event => {
        if (event.sessionId !== sessionId) return;
        const reply = JSON.parse(event.message);
        if (reply.id !== id) return;
        clearTimeout(timer);
        session.off('Target.receivedMessageFromTarget', handler);
        reply.error ? reject(new Error(reply.error.message)) : resolve(reply.result);
      };
      session.on('Target.receivedMessageFromTarget', handler);
      session.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }).catch(reject);
    });
    await send('Network.enable');
    await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  }
}
