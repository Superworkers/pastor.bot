const firstVisited = localStorage.getItem('firstVisited')
console.log('LocalStorage data:', { firstVisited })

const audioPlayer = new Audio()
audioPlayer.playsInline = true

let state = {
  audioChunks: [],
  greetingText: '',
  greetingUrl: null,
  mediaRecorder: null,
  ready: false,
  recording: false,
}

// Utils
const handle = async (fn, fallback) => {
  try {
    return await fn()
  } catch (error) {
    console.error(error)
    if (fallback) return fallback
    alert('Something went wrong. Please refresh and try again.')
    throw error
  }
}

const log = (action, startTime, result) => {
  const duration = ((Date.now() - startTime) / 1000).toFixed(1)
  const tokens = result?.usage ? ` ${result.usage.total_tokens}t` : ''
  console.log(`/${action} ${duration}s${tokens}`)
}

const play = url =>
  url &&
  handle(
    async () =>
      new Promise((resolve, reject) => {
        audioPlayer.src = url
        audioPlayer.onended = resolve
        audioPlayer.onerror = reject
        audioPlayer.play().catch(reject)
      }),
  )

const render = (content, isButton = false, onClick) => {
  if (!isButton) console.log(`Status: ${content}`)
  document.body.innerHTML = isButton ? '' : `<div>${content}</div>`
  if (isButton) {
    const btn = document.createElement('button')
    btn.textContent = content
    btn.onclick = () => {
      console.log(`Button clicked: ${content}`)
      onClick()
    }
    document.body.appendChild(btn)
  }
}

const speak = async (url, status) => {
  render(status)
  await play(url)
}

// API calls
const openai = async (endpoint, payload) => {
  const start = Date.now()
  const response = await fetch(
    `https://us-central1-samantha-374622.cloudfunctions.net/${endpoint}`,
    {
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    },
  )
  const result =
    endpoint === 'openai-tts' ? await response.blob() : await response.json()

  log(
    `${endpoint} ${
      endpoint === 'openai-tts'
        ? payload.input?.substring(0, 50)
        : endpoint === 'openai-stt'
        ? 'transcription'
        : payload.messages?.[1]?.content?.substring(0, 50)
    }`,
    start,
    endpoint === 'openai-tts' ? null : result,
  )
  return result
}

const getAudio = text =>
  handle(async () => {
    const blob = await openai('openai-tts', { input: text, model: 'tts-1', voice: 'echo' })
    return URL.createObjectURL(blob)
  })

const getText = prompt =>
  handle(async () => {
    const result = await openai('openai-4', {
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content:
            'You are Pastor Bot, a warm, charismatic evangelical pastor with a British vocabulary. Keep responses conversational and authentic.',
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: 200,
    })
    return result.choices[0].message.content
  })

const transcribe = audioBlob =>
  handle(async () => {
    const reader = new FileReader()
    const base64 = await new Promise(resolve => {
      reader.onloadend = () => resolve(reader.result.split(',')[1])
      reader.readAsDataURL(audioBlob)
    })
    const result = await openai('openai-stt', { base64, model: 'whisper-1' })
    return result.text
  })

// First, generate the greeting
const greeting = !firstVisited
  ? "Hello! I'm Pastor Bot."
  : 'Good to see you again.'
const question = !firstVisited
  ? "I'd love an opportunity to pray for you. Can you tell me a little about yourself and what you have going on in your life?"
  : 'How can I pray for you today?'

getText(
  `Generate a warm, unique greeting under 20 words that includes: "${greeting}" Then ask with a reworded statement like "${question}"`,
).then(async text => {
  state.greetingText = text || `${greeting} ${question}`
  state.greetingUrl = await getAudio(state.greetingText)
})

// Main flow
const startSession = () =>
  handle(async () => {
    if (!firstVisited) localStorage.setItem('firstVisited', Date.now())

    if (!state.greetingUrl) {
      render('One moment')
      while (!state.greetingUrl)
        await new Promise(resolve => setTimeout(resolve, 100))
    }

    await speak(state.greetingUrl, 'Pastor Bot is talking')

    // Generate transition in background
    const transitionPromise = getText(
      'Generate a simple, gentle transition under 30 words like "Thank you for sharing. Let me pray for you now. You can bow your head and close your eyes or whatever posture you feel comfortable with that might help you feel open, receptive, unguarded, and welcoming of the Spirit."',
    ).then(t => getAudio(t))

    render('Pastor Bot is listening')
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const mediaRecorder = new MediaRecorder(stream)
    const audioChunks = []

    mediaRecorder.ondataavailable = e => audioChunks.push(e.data)
    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' })

      // Pipeline: transcribe → prayer text → prayer audio
      const transcriptionPromise = transcribe(audioBlob)
      const prayerPromise = transcriptionPromise.then(t =>
        getText(
          `Based on what this person shared: "${t}", please create a heartfelt, personal prayer under 100 words for them. After "Amen", add a brief encouragement and remind them with a reworded statement like "I am always here when you need me, 24/7".`,
        ),
      )
      const prayerUrlPromise = prayerPromise.then(p =>
        p ? getAudio(p) : null,
      )

      await speak(await transitionPromise, 'Pastor Bot is talking')
      await transcriptionPromise

      // Show thinking only if prayer isn't ready
      const prayerUrl = await Promise.race([
        prayerUrlPromise,
        new Promise(resolve => setTimeout(() => resolve(null), 100)),
      ])

      if (!prayerUrl) render('Pastor Bot is thinking')

      const finalPrayerUrl = prayerUrl || (await prayerUrlPromise)
      if (finalPrayerUrl) await speak(finalPrayerUrl, 'Pastor Bot is praying')

      document.body.innerHTML = `
        <div>Let us know what you think!</div>
        <a href="https://discord.gg/ng8RNjm5Jz">Join our Discord</a>
      `
    }

    mediaRecorder.start()
    setTimeout(() => {
      render('I’m done sharing', true, () => {
        mediaRecorder.stop()
        stream.getTracks().forEach(track => track.stop())
      })
    }, 10000)
  })

// Initialize
render('Meet Pastor Bot', true, startSession)
