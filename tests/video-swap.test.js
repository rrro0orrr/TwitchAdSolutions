const test = require('node:test');
const assert = require('node:assert/strict');
const { readScript, createScriptContext } = require('./scripts');

const files = ['video-swap-new/video-swap-new.user.js', 'video-swap-new/video-swap-new-ublock-origin.js'];

for (const file of files) {
    test('synthetic resilience: backup merge preserves variants without resolution in ' + file, async () => {
        const video = 'https://cdn.invalid/video.m3u8';
        const audio = 'https://cdn.invalid/audio.m3u8';
        const backup = 'https://cdn.invalid/backup.m3u8';
        const videoAttributes = '#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720';
        const audioAttributes = '#EXT-X-STREAM-INF:BANDWIDTH=128000,CODECS="mp4a.40.2"';
        const media = '#EXTM3U\n#EXTINF:2,\nhttps://cdn.invalid/segment.ts\n';
        const context = createScriptContext(readScript(file), {
            URL, console: { log() {}, error() {} }, postMessage() {}
        });
        context.getAccessToken = async () => Response.json({
            streamPlaybackAccessToken: { signature: 'fixture', value: 'fixture' }
        });
        const stream = context.createStreamInfo('fixture', '');
        stream.Encodings = ['#EXTM3U', videoAttributes, video, audioAttributes, audio].join('\n');
        context.setStreamInfoUrls(stream, stream.Encodings);

        const result = await context.onFoundAd(stream, '#EXTM3U', false, async url => {
            if (url === backup) return new Response(media);
            assert.equal(new URL(url).hostname, 'usher.ttvnw.net');
            return new Response(['#EXTM3U', videoAttributes, backup].join('\n'));
        }, video, stream.Urls.get(video));

        assert.equal(result, media);
        assert.deepEqual(stream.BackupEncodings.split('\n').map(line => line.trimEnd()),
            ['#EXTM3U', videoAttributes, backup, audioAttributes, audio]);
    });

    test('synthetic resilience: replaced worker cannot reload the active player in ' + file, () => {
        const reloads = [];
        class MockWorker extends EventTarget {}
        class MockURL extends URL {
            static revokeObjectURL() {}
        }
        const context = createScriptContext(readScript(file), {
            window: { Worker: MockWorker }, URL: MockURL,
            console: { log() {}, error() {} },
            twitchWorkers: [], workerStringConflicts: [], workerStringAllow: [], workerStringReinsert: []
        });
        context.getWasmWorkerJs = () => 'hookWorkerFetch';
        context.reloadTwitchPlayer = (...args) => reloads.push(args);
        context.hookWindowWorker();

        const previous = new context.window.Worker('blob:https://www.twitch.tv/previous');
        const current = new context.window.Worker('blob:https://www.twitch.tv/current');
        const reload = () => new MessageEvent('message', { data: { key: 'UboReloadPlayer', kind: 'early' } });
        previous.dispatchEvent(reload());
        previous.dispatchEvent(new Event('error'));
        assert.deepEqual(reloads, []);

        current.dispatchEvent(reload());
        current.dispatchEvent(new Event('error'));
        current.dispatchEvent(new Event('error'));
        assert.deepEqual(reloads, [[false, 'early'], [false]]);
    });
}
