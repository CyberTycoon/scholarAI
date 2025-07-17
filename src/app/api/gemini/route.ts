import { NextResponse } from 'next/server'

// Helper function to decode base64 content for images
function decodeImageContent(base64Content: string): string {
    try {
        // Extract the base64 data (remove data:image/...;base64, prefix)
        const base64Data = base64Content.split(',')[1]
        if (!base64Data) return '[Image content could not be decoded]'

        // For now, we'll just return a description since Gemini needs special handling for images
        return `[Image file detected - Base64 encoded image with ${base64Data.length} characters of data]`
    } catch (error) {
        return '[Image content could not be decoded]'
    }
}

// Helper function to clean and decode text content
function decodeTextContent(content: string, filename: string): string {
    try {
        // Handle different text encodings and clean up the content
        let decodedContent = content

        // Remove BOM if present
        if (decodedContent.charCodeAt(0) === 0xFEFF) {
            decodedContent = decodedContent.slice(1)
        }

        // Clean up common encoding issues
        decodedContent = decodedContent
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .replace(/\u0000/g, '') // Remove null characters
            .trim()

        // If content is empty after cleaning
        if (!decodedContent) {
            return `[${filename} appears to be empty or contains only whitespace]`
        }

        return decodedContent
    } catch (error) {
        return `[Error decoding content from ${filename}]`
    }
}

// Helper function to extract text from CSV
function processCSVContent(content: string, filename: string): string {
    try {
        const lines = content.split('\n').filter(line => line.trim())
        if (lines.length === 0) return `[${filename} appears to be empty]`

        const preview = lines.slice(0, 20).join('\n') // First 20 lines
        let summary = `CSV File: ${filename}\nRows: ${lines.length}\nFirst 20 rows:\n${preview}`

        if (lines.length > 20) {
            summary += `\n\n... and ${lines.length - 20} more rows`
        }

        return summary
    } catch (error) {
        return `[Error processing CSV file ${filename}]`
    }
}

// Helper function to process JSON content
function processJSONContent(content: string, filename: string): string {
    try {
        const parsed = JSON.parse(content)
        const formatted = JSON.stringify(parsed, null, 2)

        // Limit size to prevent token overflow
        if (formatted.length > 3000) {
            return `JSON File: ${filename}\nStructure preview:\n${formatted.substring(0, 3000)}...\n\n[Content truncated due to size]`
        }

        return `JSON File: ${filename}\nContent:\n${formatted}`
    } catch (error) {
        return `JSON File: ${filename}\nRaw content (invalid JSON):\n${content.substring(0, 2000)}`
    }
}

export async function POST(request: Request) {
    try {
        const formData = await request.formData()
        const message = formData.get('message') as string
        const fileCount = parseInt(formData.get('fileCount') as string) || 0

        // Parse uploaded files
        const files = []
        for (let i = 0; i < fileCount; i++) {
            const fileData = formData.get(`file_${i}`) as string
            if (fileData) {
                try {
                    const parsedFile = JSON.parse(fileData)
                    files.push(parsedFile)
                } catch (err) {
                    console.error(`Error parsing file ${i}:`, err)
                }
            }
        }

        if (!message && files.length === 0) {
            return NextResponse.json({
                success: false,
                error: 'No message or files provided'
            }, { status: 400 })
        }

        const GEMINI_API_KEY = process.env.GEMINI_API_KEY
        if (!GEMINI_API_KEY) {
            return NextResponse.json({
                success: false,
                error: 'Gemini API key not set.'
            }, { status: 500 })
        }

        const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent'

        // Build the prompt with properly decoded file content
        let fullPrompt = "You are ScholarAI, an expert AI research assistant. Answer as a helpful, knowledgeable, and friendly research assistant."

        if (message) {
            fullPrompt += `\n\nUser message: ${message}`
        }

        if (files.length > 0) {
            fullPrompt += `\n\nThe user has uploaded ${files.length} file(s). Please analyze the content and provide insights:`

            files.forEach((file, index) => {
                fullPrompt += `\n\n--- File ${index + 1}: ${file.name} (${file.type}) ---`

                let decodedContent = ''

                // Handle different file types with proper decoding
                if (file.type.startsWith('image/')) {
                    decodedContent = decodeImageContent(file.content)
                } else if (file.type.includes('csv') || file.name.toLowerCase().endsWith('.csv')) {
                    decodedContent = processCSVContent(decodeTextContent(file.content, file.name), file.name)
                } else if (file.type.includes('json') || file.name.toLowerCase().endsWith('.json')) {
                    decodedContent = processJSONContent(decodeTextContent(file.content, file.name), file.name)
                } else if (file.type.includes('pdf')) {
                    // Note: Basic PDF text extraction is limited - in production use a proper PDF parser
                    decodedContent = `PDF File: ${file.name}\n[Note: PDF parsing is limited in this implementation]\n${decodeTextContent(file.content, file.name).substring(0, 3000)}`
                } else {
                    // Handle text files, markdown, code files, etc.
                    decodedContent = decodeTextContent(file.content, file.name)
                }

                // Limit content length to prevent token overflow
                if (decodedContent.length > 4000) {
                    decodedContent = decodedContent.substring(0, 4000) + '\n\n[Content truncated due to length]'
                }

                fullPrompt += `\n${decodedContent}`
            })

            fullPrompt += `\n\nPlease provide a comprehensive analysis of the uploaded content. Include summaries, key insights, and answer any questions about the files.`
        }

        const requestBody = {
            contents: [{
                parts: [{ text: fullPrompt }]
            }],
            generationConfig: {
                temperature: 0.3,
                topP: 0.9,
                maxOutputTokens: 2048
            }
        }

        const geminiRes = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        })

        if (!geminiRes.ok) {
            const errorText = await geminiRes.text()
            return NextResponse.json({
                success: false,
                error: `Gemini API error: ${geminiRes.status} - ${errorText}`
            }, { status: 500 })
        }

        const geminiData = await geminiRes.json()
        const aiResponse = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || ''

        return NextResponse.json({
            success: true,
            response: aiResponse,
            filesProcessed: files.length
        })

    } catch (error) {
        console.error('API Error:', error)
        return NextResponse.json({
            success: false,
            error: 'Unexpected error: ' + (error instanceof Error ? error.message : 'Unknown error')
        }, { status: 500 })
    }
}