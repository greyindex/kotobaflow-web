// Generate silent Ogg/Opus in memory: real Chromium decoding, seeking and media
// events, with no TTS pack, encoder executable or generated audio file in Git.
// Container layout: https://www.rfc-editor.org/rfc/rfc7845.html
function silentOgg(seconds) {
  const page = (packets, sequence, granule, flags = 0) => {
    const header = Buffer.alloc(27 + packets.length);
    header.write('OggS');
    header[5] = flags;
    header.writeBigUInt64LE(BigInt(granule), 6);
    header.writeUInt32LE(1, 14);
    header.writeUInt32LE(sequence, 18);
    header[26] = packets.length;
    packets.forEach((packet, index) => (header[27 + index] = packet.length));
    const bytes = Buffer.concat([header, ...packets]);
    let crc = 0;
    for (const byte of bytes) {
      crc ^= byte << 24;
      for (let bit = 0; bit < 8; bit++) crc = (crc << 1) ^ (crc & 0x80000000 ? 0x04c11db7 : 0);
    }
    bytes.writeUInt32LE(crc >>> 0, 22);
    return bytes;
  };
  const preSkip = 312;
  const head = Buffer.alloc(19);
  head.write('OpusHead');
  head[8] = 1;
  head[9] = 1;
  head.writeUInt16LE(preSkip, 10);
  head.writeUInt32LE(48000, 12);
  const tags = Buffer.alloc(16);
  tags.write('OpusTags');
  const pages = [page([head], 0, 0, 2), page([tags], 1, 0)];
  const finalGranule = preSkip + seconds * 48000;
  const count = Math.ceil(finalGranule / 960);
  // One valid 20 ms CELT silence packet; each audio page contains one second.
  const packet = Buffer.from([0xf8, 0xff, 0xfe]);
  for (let start = 0; start < count; start += 50) {
    const end = Math.min(start + 50, count);
    pages.push(
      page(
        Array(end - start).fill(packet),
        pages.length,
        Math.min(end * 960, finalGranule),
        end === count ? 4 : 0,
      ),
    );
  }
  return Buffer.concat(pages);
}

async function useAudioFixtures(page, options = {}) {
  const dialogueRoot = '/data/gemini38_flash_tts_dialogue_sections_candidate_v1/';
  const readingRoot = '/data/gemini38_flash_tts_reading_sections_candidate_v1/';
  const files = new Map();
  const dialogueRows = [];
  const readingRows = [];
  for (const [number, turnCount] of [
    [2, 23],
    [3, 26],
  ]) {
    const label = String(number).padStart(2, '0');
    const lessonId = `lesson_${label}`;
    const directory = `XinBian1/${label}_${lessonId}/`;
    const timingPath = `${dialogueRoot}${directory}conversation/manifest.json`;
    const dialoguePath = `${dialogueRoot}${directory}conversation/XinBian1_${label}_conversation_dialogue.ogg`;
    const readingPath = `${readingRoot}${directory}body/XinBian1_${label}_body_reading.ogg`;
    const identity = {
      status: 'ok',
      book: 'XinBian1',
      lesson_id: lessonId,
      lesson_no: number,
      source_revision_mismatch: !!options.reviewNotice,
    };
    dialogueRows.push({ ...identity, section_key: 'conversation', manifest: timingPath, turn_gap_sec: 0.25 });
    readingRows.push({ ...identity, section_key: 'body' });
    const turns = Array.from({ length: turnCount }, (_, index) => {
      if (!options.absolute) return { duration_sec: 4 };
      if (options.notSpoken?.includes(index)) return { status: 'not_spoken' };
      if (options.unaligned?.includes(index)) return { status: 'unaligned' };
      return {
        status: 'candidate',
        start_sec: index * 4.25 + 0.4,
        end_sec: index * 4.25 + 3.1,
        source_revision_mismatch: !!options.reviewNotice,
      };
    });
    files.set(timingPath, {
      json: options.absolute
        ? { schema: 2, mode: 'absolute', duration_sec: Math.ceil(turnCount * 4.25), turns }
        : turns,
    });
    files.set(dialoguePath, { audio: silentOgg(Math.ceil(turnCount * 4.25)) });
    files.set(readingPath, { audio: silentOgg(12) });
  }
  files.set(`${dialogueRoot}manifest.jsonl`, {
    body: dialogueRows.map((row) => JSON.stringify(row)).join('\n'),
  });
  files.set(`${readingRoot}manifest.jsonl`, {
    body: readingRows.map((row) => JSON.stringify(row)).join('\n'),
  });
  const vocabularyAudio = silentOgg(2);
  await page.route(
    /\/data\/(?:gcloud_chirp3_|gemini38_flash_tts_(?:reading|dialogue)_sections_candidate_v1\/)/,
    async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      const file = files.get(pathname);
      const audio =
        file?.audio ||
        (/\/gcloud_chirp3_vocab(?:6127|12528)_female_aoede_v1\/audio\/\d{2}xxx\/\d{5}\.ogg$/.test(pathname)
          ? vocabularyAudio
          : null);
      if (audio) {
        const range = route
          .request()
          .headers()
          .range?.match(/^bytes=(\d+)-(\d*)$/);
        const start = range ? Number(range[1]) : 0;
        const end = range?.[2] ? Math.min(Number(range[2]), audio.length - 1) : audio.length - 1;
        await route.fulfill({
          status: range ? 206 : 200,
          contentType: 'audio/ogg',
          headers: {
            'accept-ranges': 'bytes',
            ...(range ? { 'content-range': `bytes ${start}-${end}/${audio.length}` } : {}),
          },
          body: audio.subarray(start, end + 1),
        });
      } else if (file?.json) {
        await route.fulfill({ json: file.json });
      } else if (file) {
        await route.fulfill({ contentType: 'application/x-ndjson', body: file.body });
      } else {
        // An unconfigured audio request must fail, never fall through to a local pack.
        await route.fulfill({ status: 404, body: '' });
      }
    },
  );
}

module.exports = { useAudioFixtures, silentOgg };
