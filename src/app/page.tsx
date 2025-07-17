'use client'

import { useState, useRef, useCallback } from 'react'
import { Upload, X, FileText, Image, File, Paperclip, Plus } from 'lucide-react'

interface ChatMessage {
  sender: 'user' | 'system' | 'ai'
  text: string
  files?: UploadedFile[]
}

interface UploadedFile {
  name: string
  size: number
  type: string
  content: string
  id: string
}

// Helper to render Gemini markdown-like output (bold **text**)
function renderGeminiMarkdown(text: string) {
  // Replace **bold** with <strong>bold</strong>
  const bolded = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
  // You can add more formatting rules here if needed
  return bolded
}

// Helper to format file size
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// Helper to get file icon
function getFileIcon(type: string) {
  if (type.startsWith('image/')) return <Image className="w-4 h-4" />
  if (type.includes('pdf') || type.includes('document') || type.includes('text')) return <FileText className="w-4 h-4" />
  return <File className="w-4 h-4" />
}

export default function Home() {
  const [chat, setChat] = useState<ChatMessage[]>([
    { sender: 'system', text: "👋 Welcome! I'm ScholarAI, your research assistant. Ask me anything about your research or upload files for analysis!" }
  ])
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // File reading helper
  const readFileContent = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => resolve(e.target?.result as string)
      reader.onerror = reject

      if (file.type.startsWith('image/')) {
        reader.readAsDataURL(file)
      } else if (file.type.includes('pdf')) {
        // For PDFs, we'll read as text but note that this is limited
        // In a real app, you'd want to use a PDF parsing library
        reader.readAsText(file)
      } else {
        // For text files, JSON, CSV, etc.
        reader.readAsText(file, 'UTF-8')
      }
    })
  }, [])

  // Handle file upload
  const handleFileUpload = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return

    const newFiles: UploadedFile[] = []
    const maxSize = 10 * 1024 * 1024 // 10MB limit

    for (let i = 0; i < files.length; i++) {
      const file = files[i]

      if (file.size > maxSize) {
        setError(`File ${file.name} is too large. Maximum size is 10MB.`)
        continue
      }

      // Check supported file types
      const supportedTypes = [
        'text/plain', 'text/csv', 'text/markdown', 'text/html', 'text/css', 'text/javascript',
        'application/json', 'application/xml', 'text/xml',
        'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'
      ]

      const isSupported = supportedTypes.some(type => file.type.includes(type.split('/')[1])) || file.type.startsWith('text/')

      if (!isSupported) {
        setError(`File type ${file.type} is not supported. Please upload text, document, or image files.`)
        continue
      }

      try {
        const content = await readFileContent(file)
        newFiles.push({
          id: Date.now() + i + '',
          name: file.name,
          size: file.size,
          type: file.type,
          content
        })
      } catch (err) {
        setError(`Failed to read file ${file.name}`)
      }
    }

    setUploadedFiles(prev => [...prev, ...newFiles])
  }, [readFileContent])

  // Handle drag and drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    handleFileUpload(e.dataTransfer.files)
  }, [handleFileUpload])

  // Remove uploaded file
  const removeFile = useCallback((id: string) => {
    setUploadedFiles(prev => prev.filter(file => file.id !== id))
  }, [])

  const handleAsk = async (e?: React.FormEvent | React.KeyboardEvent) => {
    e?.preventDefault()
    const userMessage = message.trim()
    if (!userMessage && uploadedFiles.length === 0) return

    const userChatMessage: ChatMessage = {
      sender: 'user',
      text: userMessage || 'File analysis request',
      files: uploadedFiles.length > 0 ? [...uploadedFiles] : undefined
    }

    setChat(prev => [...prev, userChatMessage])
    setMessage('')
    setLoading(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('message', userMessage)

      // Add files to form data
      uploadedFiles.forEach((file, index) => {
        formData.append(`file_${index}`, JSON.stringify({
          name: file.name,
          type: file.type,
          content: file.content
        }))
      })
      formData.append('fileCount', uploadedFiles.length.toString())

      const response = await fetch('/api/gemini', {
        method: 'POST',
        body: formData
      })

      const contentType = response.headers.get('content-type')
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error(`Server returned HTML instead of JSON. Status: ${response.status}`)
      }

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || `Server error: ${response.status}`)
      }

      if (data.success && data.response) {
        setChat(prev => [...prev, { sender: 'ai', text: data.response }])
      } else {
        throw new Error('Invalid response format from server')
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred')
      setChat(prev => [...prev, { sender: 'ai', text: 'Sorry, I could not process your request.' }])
    } finally {
      setLoading(false)
      setUploadedFiles([]) // Clear uploaded files after sending
    }
  }

  return (
    <div className="min-h-screen bg-white text-black flex flex-col w-full">
      <div className="flex flex-col flex-1 w-full max-w-full mx-auto" style={{ minHeight: '100vh' }}>
        {/* Header */}
        <div className="w-full px-4 py-6 border-b border-gray-200 flex items-center justify-between">
          <div className="text-2xl font-bold text-black flex items-center gap-2">
            <span>ScholarAI</span>
            <span className="text-xs font-normal text-gray-500">Research Assistant</span>
          </div>
        </div>

        {/* Chat Area */}
        <div
          className={`flex-1 w-full max-w-full mx-auto overflow-y-auto px-0 md:px-0 pb-32 transition-all duration-200 ${isDragging ? 'bg-blue-50 border-2 border-dashed border-blue-300' : 'bg-white'
            }`}
          style={{ background: isDragging ? '#f0f9ff' : 'white' }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {isDragging && (
            <div className="absolute inset-0 flex items-center justify-center bg-blue-50 bg-opacity-90 z-10">
              <div className="text-center">
                <Upload className="w-12 h-12 text-blue-500 mx-auto mb-4" />
                <p className="text-lg font-medium text-blue-700">Drop files here to upload</p>
                <p className="text-sm text-blue-600">Supports PDF, TXT, DOC, images and more</p>
              </div>
            </div>
          )}

          <div className="w-full p-4 space-y-4">
            {chat.map((msg, i) => (
              <div key={i} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-xl w-full sm:max-w-2xl`}>
                  {msg.sender === 'ai' ? (
                    <div
                      className={`px-4 py-2 rounded-xl text-sm whitespace-pre-line bg-black text-white`}
                      dangerouslySetInnerHTML={{ __html: renderGeminiMarkdown(msg.text) }}
                    />
                  ) : (
                    <div className={`px-4 py-2 rounded-xl text-sm whitespace-pre-line ${msg.sender === 'user' ? 'bg-gray-100 text-black' : 'bg-gray-50 text-black'
                      }`}>
                      {msg.text}
                    </div>
                  )}

                  {/* Display uploaded files */}
                  {msg.files && msg.files.length > 0 && (
                    <div className="mt-2 space-y-2">
                      {msg.files.map((file) => (
                        <div key={file.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg border">
                          {getFileIcon(file.type)}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
                            <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="max-w-[80%] px-4 py-2 rounded-xl shadow bg-gray-50 text-purple-900 text-sm animate-pulse">
                  ScholarAI is processing your request...
                </div>
              </div>
            )}
          </div>
        </div>

        {/* File Upload Area */}
        {uploadedFiles.length > 0 && (
          <div className="fixed bottom-16 left-0 w-full bg-white border-t border-gray-200 z-10 max-h-32 overflow-y-auto">
            <div className="p-3">
              <div className="flex items-center gap-2 mb-2">
                <Paperclip className="w-4 h-4 text-gray-500" />
                <span className="text-sm font-medium text-gray-700">Attached Files</span>
              </div>
              <div className="space-y-2">
                {uploadedFiles.map((file) => (
                  <div key={file.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg border">
                    {getFileIcon(file.type)}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
                      <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
                    </div>
                    <button
                      onClick={() => removeFile(file.id)}
                      className="p-1 hover:bg-gray-200 rounded-full transition-colors"
                    >
                      <X className="w-4 h-4 text-gray-500" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Chat Input Fixed at Bottom */}
        <div
          className="fixed bottom-0 left-0 w-full bg-white border-t border-gray-200 z-10"
          style={{ boxShadow: '0 -2px 8px rgba(0,0,0,0.03)' }}
        >
          <div className="w-full flex items-center gap-2 px-4 py-3">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors flex items-center justify-center"
                title="Attach files"
              >
                <svg
                  className="w-5 h-5 text-gray-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                  />
                </svg>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                accept=".pdf,.txt,.doc,.docx,.csv,.json,.md,.png,.jpg,.jpeg,.gif,.webp"
                onChange={(e) => handleFileUpload(e.target.files)}
              />
            </div>
            <input
              ref={inputRef}
              type="text"
              value={message}
              onChange={e => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleAsk(e as any)
                }
              }}
              placeholder="Ask a question, upload files, or request analysis..."
              className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring bg-white text-black"
              style={{ minWidth: 0 }}
              disabled={loading}
            />
            <button
              type="button"
              onClick={handleAsk}
              className="px-4 py-2 rounded bg-black text-white text-xs font-semibold hover:bg-gray-800 border border-black transition disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={(!message.trim() && uploadedFiles.length === 0) || loading}
              style={{ minWidth: 80 }}
            >
              Send
            </button>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="fixed bottom-20 left-0 w-full flex justify-center z-20">
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl mt-2 max-w-2xl w-full mx-auto">
              <div className="flex items-center space-x-2">
                <svg className="w-5 h-5 text-red-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-red-800 text-sm">{error}</p>
                <button
                  onClick={() => setError(null)}
                  className="ml-auto text-red-600 hover:text-red-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}