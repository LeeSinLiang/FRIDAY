import * as board from '../board.mjs';
import { startServer } from '../server.mjs';

let server;
process.on('message', async ({ id, action, args = [] }) => {
    try {
        let result;
        if (action === 'start') {
            server = await startServer();
            result = server.url;
        } else if (action === 'close') {
            await server.close();
            result = board.events.listenerCount('changed');
        } else if (action === 'batch') {
            const [componentId, prefix, count] = args;
            result = await Promise.all(Array.from({ length: count }, (_, index) =>
                board.addTask(componentId, 'mvp', `${prefix}-${index}`)));
        } else if (action === 'detached') {
            const copy = await board.getBoard();
            copy.title = 'Unpersisted change';
            result = await board.getBoard();
        } else {
            result = await board[action](...args);
        }
        process.send({ id, result });
    } catch (error) {
        process.send({ id, error: error.message });
    }
});
process.send({ ready: true });
