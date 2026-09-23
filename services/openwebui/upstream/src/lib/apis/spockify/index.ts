import { WEBUI_API_BASE_URL } from '$lib/constants';

export const SPOCKIFY_API_BASE_URL = `${WEBUI_API_BASE_URL}/spockify`;

export const getSpockifyStatus = async (token: string = '') => {
	let error = null;

	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/status`, {
		method: 'GET',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			...(token && { authorization: `Bearer ${token}` })
		}
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.catch((err) => {
			console.error(err);
			if (err && typeof err === 'object' && 'detail' in err) {
				error = err.detail;
			} else {
				error = 'Server connection failed';
			}
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

export const unloadOllamaForGpu = async (token: string = '') => {
	let error = null;

	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/unload-ollama`, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			...(token && { authorization: `Bearer ${token}` })
		}
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.catch((err) => {
			console.error(err);
			if (err && typeof err === 'object' && 'detail' in err) {
				error = err.detail;
			} else {
				error = 'Server connection failed';
			}
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

export const getSpockifyUsage = async (token: string = '') => {
	let error = null;

	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/usage`, {
		method: 'GET',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			...(token && { authorization: `Bearer ${token}` })
		}
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.catch((err) => {
			console.error(err);
			if (err && typeof err === 'object' && 'detail' in err) {
				error = err.detail;
			} else {
				error = 'Server connection failed';
			}
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

export const getSpockifyMemory = async (token: string = '', opts?: { q?: string }) => {
	const params = new URLSearchParams();
	if (opts?.q) params.set('q', opts.q);
	const qs = params.toString();
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/memory${qs ? `?${qs}` : ''}`, {
		method: 'GET',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			...(token && { authorization: `Bearer ${token}` })
		}
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const updateSpockifyProjectSummary = async (
	token: string,
	folderId: string,
	project_summary: string
) => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/memory/projects/${folderId}`, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			...(token && { authorization: `Bearer ${token}` })
		},
		body: JSON.stringify({ project_summary })
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const deleteSpockifySessionDigest = async (token: string, digestId: string) => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/memory/sessions/${digestId}`, {
		method: 'DELETE',
		headers: {
			Accept: 'application/json',
			...(token && { authorization: `Bearer ${token}` })
		}
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const getVoiceClone = async (token: string = '') => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/voice-clone`, {
		method: 'GET',
		headers: {
			Accept: 'application/json',
			...(token && { authorization: `Bearer ${token}` })
		}
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const uploadVoiceClone = async (
	token: string,
	file: File,
	opts?: { enabled?: boolean; edge_voice?: string; label?: string }
) => {
	const body = new FormData();
	body.append('file', file);
	body.append('enabled', String(opts?.enabled ?? true));
	if (opts?.edge_voice) body.append('edge_voice', opts.edge_voice);
	if (opts?.label) body.append('label', opts.label);
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/voice-clone`, {
		method: 'POST',
		headers: {
			...(token && { authorization: `Bearer ${token}` })
		},
		body
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const updateVoiceClone = async (
	token: string,
	patch: { enabled?: boolean; edge_voice?: string; rate?: string; pitch?: string; label?: string }
) => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/voice-clone`, {
		method: 'PATCH',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			...(token && { authorization: `Bearer ${token}` })
		},
		body: JSON.stringify(patch)
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const deleteVoiceClone = async (token: string = '') => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/voice-clone`, {
		method: 'DELETE',
		headers: {
			Accept: 'application/json',
			...(token && { authorization: `Bearer ${token}` })
		}
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const enableLiveShare = async (
	token: string,
	chatId: string,
	opts?: { ttl_seconds?: number | null }
) => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/live/${chatId}`, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			...(token && { authorization: `Bearer ${token}` })
		},
		body: JSON.stringify({
			...(opts?.ttl_seconds != null ? { ttl_seconds: opts.ttl_seconds } : {})
		})
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const disableLiveShare = async (token: string, chatId: string) => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/live/${chatId}`, {
		method: 'DELETE',
		headers: {
			Accept: 'application/json',
			...(token && { authorization: `Bearer ${token}` })
		}
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const viewLiveShare = async (liveToken: string) => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/live/view/${liveToken}`, {
		method: 'GET',
		headers: { Accept: 'application/json' }
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const listAgentRuns = async (token: string = '', limit: number = 50) => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/agents/runs?limit=${limit}`, {
		method: 'GET',
		headers: {
			Accept: 'application/json',
			...(token && { authorization: `Bearer ${token}` })
		}
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const getAgentRun = async (token: string, runId: string) => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/agents/runs/${runId}`, {
		method: 'GET',
		headers: {
			Accept: 'application/json',
			...(token && { authorization: `Bearer ${token}` })
		}
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const getAgentRunByMessageId = async (token: string, messageId: string) => {
	const res = await fetch(
		`${SPOCKIFY_API_BASE_URL}/agents/runs/by-message/${encodeURIComponent(messageId)}`,
		{
			method: 'GET',
			headers: {
				Accept: 'application/json',
				...(token && { authorization: `Bearer ${token}` })
			}
		}
	);
	if (!res.ok) throw await res.json();
	return res.json();
};

export const createAgentRun = async (
	token: string,
	body: {
		parent_prompt: string;
		model?: string;
		workers?: Array<{ id?: string; name?: string; model?: string; prompt: string }>;
		synthesize?: boolean;
	}
) => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/agents/runs`, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			...(token && { authorization: `Bearer ${token}` })
		},
		body: JSON.stringify(body)
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const cancelAgentRun = async (token: string, runId: string) => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/agents/runs/${runId}/cancel`, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			...(token && { authorization: `Bearer ${token}` })
		}
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const cancelAgentWorker = async (token: string, runId: string, workerId: string) => {
	const res = await fetch(
		`${SPOCKIFY_API_BASE_URL}/agents/runs/${runId}/workers/${encodeURIComponent(workerId)}/cancel`,
		{
			method: 'POST',
			headers: {
				Accept: 'application/json',
				...(token && { authorization: `Bearer ${token}` })
			}
		}
	);
	if (!res.ok) throw await res.json();
	return res.json();
};

// --- Wave 9 ---

const authHeaders = (token: string) => ({
	Accept: 'application/json',
	'Content-Type': 'application/json',
	...(token && { authorization: `Bearer ${token}` })
});

export const getConnectors = async (token: string = '') => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/connectors`, {
		method: 'GET',
		headers: authHeaders(token)
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const putConnectors = async (token: string, body: { connectors: any[] }) => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/connectors`, {
		method: 'PUT',
		headers: authHeaders(token),
		body: JSON.stringify(body)
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const migrateLegacyConnectors = async (token: string = '') => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/connectors/migrate-legacy`, {
		method: 'POST',
		headers: authHeaders(token)
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const getConnectorsBriefing = async (token: string = '') => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/connectors/briefing`, {
		method: 'GET',
		headers: authHeaders(token)
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const testConnector = async (token: string, kind: string) => {
	const res = await fetch(
		`${SPOCKIFY_API_BASE_URL}/connectors/${encodeURIComponent(kind)}/test`,
		{
			method: 'POST',
			headers: authHeaders(token)
		}
	);
	if (!res.ok) throw await res.json();
	return res.json();
};

export const getCalendarEvents = async (
	token: string = '',
	opts: { start?: string; end?: string; limit?: number } = {}
) => {
	const params = new URLSearchParams();
	if (opts.start) params.set('start', opts.start);
	if (opts.end) params.set('end', opts.end);
	if (opts.limit != null) params.set('limit', String(opts.limit));
	const qs = params.toString();
	const res = await fetch(
		`${SPOCKIFY_API_BASE_URL}/connectors/calendar/events${qs ? `?${qs}` : ''}`,
		{
			method: 'GET',
			headers: authHeaders(token)
		}
	);
	if (!res.ok) throw await res.json();
	return res.json();
};

export const getSkillsPacks = async (token: string = '') => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/skills`, {
		method: 'GET',
		headers: authHeaders(token)
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const getEvalSets = async (token: string = '') => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/eval/sets`, {
		method: 'GET',
		headers: authHeaders(token)
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const saveEvalSet = async (token: string, body: any) => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/eval/sets`, {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify(body)
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const runEvalBoard = async (token: string, body: { set_id: string; models?: string[] }) => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/eval/run`, {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify(body)
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const getEvalRuns = async (token: string = '', limit: number = 30) => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/eval/runs?limit=${limit}`, {
		method: 'GET',
		headers: authHeaders(token)
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const getFamilyMode = async (token: string = '') => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/family`, {
		method: 'GET',
		headers: authHeaders(token)
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const putFamilyMode = async (token: string, body: any) => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/family`, {
		method: 'PUT',
		headers: authHeaders(token),
		body: JSON.stringify(body)
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const vaultLockChat = async (
	token: string,
	body: { chat_id: string; passphrase: string; lock: boolean }
) => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/vault/lock`, {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify(body)
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const getVaultStatus = async (token: string, chatId: string) => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/vault/${chatId}`, {
		method: 'GET',
		headers: authHeaders(token)
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const generatePodcast = async (
	token: string,
	body: { text: string; title?: string; voice_a?: string; voice_b?: string }
) => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/podcast`, {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify(body)
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({ detail: 'podcast failed' }));
		throw err;
	}
	return res.blob();
};

export const xttsCheck = async (token: string = '') => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/voice-clone/xtts-check`, {
		method: 'POST',
		headers: authHeaders(token)
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

// --- Wave 10 ---

export const submitScreenFrames = async (token: string, body: any) => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/screen/frames`, {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify(body)
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const forkAgentRun = async (
	token: string,
	runId: string,
	body: { worker_id: string; what_if?: string; prompt_override?: string }
) => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/agents/runs/${runId}/fork`, {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify(body)
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const homeBrainIngest = async (token: string, body: any) => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/home/ingest`, {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify(body)
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const listHomeBrainEvents = async (token: string, limit = 30) => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/home/events?limit=${limit}`, {
		headers: authHeaders(token)
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const ghostSuggest = async (token: string, body: any) => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/ghost/suggest`, {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify(body)
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const ghostWorkspaceList = async (token: string) => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/ghost/workspace`, {
		headers: authHeaders(token)
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const ghostWorkspaceRead = async (token: string, path: str) => {
	const q = new URLSearchParams({ path });
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/ghost/workspace/file?${q}`, {
		headers: authHeaders(token)
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const ghostWorkspaceWrite = async (
	token: string,
	body: { path: string; content: string }
) => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/ghost/workspace/file`, {
		method: 'PUT',
		headers: authHeaders(token),
		body: JSON.stringify(body)
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const ghostWorkspaceMkdir = async (token: string, body: { path: string }) => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/ghost/workspace/mkdir`, {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify(body)
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const ghostWorkspaceRename = async (
	token: string,
	body: { from_path: string; to_path: string }
) => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/ghost/workspace/rename`, {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify(body)
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const ghostWorkspaceDelete = async (token: string, path: str) => {
	const q = new URLSearchParams({ path });
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/ghost/workspace/file?${q}`, {
		method: 'DELETE',
		headers: authHeaders(token)
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

const blobAuthHeaders = (token: string) => ({
	...(token && { authorization: `Bearer ${token}` })
});

const filenameFromDisposition = (disposition: string | null, fallback: string) => {
	const match = (disposition || '').match(/filename="?([^";]+)"?/i);
	return (match?.[1] || fallback).trim() || fallback;
};

/** Trigger a browser download from a Blob (no server paths exposed). */
export const triggerBrowserDownload = (blob: Blob, filename: string) => {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename || 'download';
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
};

export const ghostWorkspaceDownloadFile = async (
	token: string,
	path: string
): Promise<{ blob: Blob; filename: string }> => {
	const q = new URLSearchParams({ path });
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/ghost/workspace/download?${q}`, {
		headers: blobAuthHeaders(token)
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({ detail: res.statusText }));
		throw err;
	}
	const filename = filenameFromDisposition(
		res.headers.get('content-disposition'),
		path.split('/').pop() || 'download'
	);
	return { blob: await res.blob(), filename };
};

export const ghostWorkspaceDownloadZip = async (
	token: string
): Promise<{ blob: Blob; filename: string }> => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/ghost/workspace/download.zip`, {
		headers: blobAuthHeaders(token)
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({ detail: res.statusText }));
		throw err;
	}
	const filename = filenameFromDisposition(
		res.headers.get('content-disposition'),
		'ghost-workspace.zip'
	);
	return { blob: await res.blob(), filename };
};

export const createRoom = async (token: string, body: any) => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/rooms`, {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify(body)
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const listRooms = async (token: string) => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/rooms`, { headers: authHeaders(token) });
	if (!res.ok) throw await res.json();
	return res.json();
};

export const getRoom = async (token: string, roomId: string) => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/rooms/${roomId}`, {
		headers: authHeaders(token)
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const joinRoom = async (token: string, roomId: string, body: any) => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/rooms/${roomId}/join`, {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify(body)
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const postRoomMessage = async (
	token: string,
	roomId: string,
	body: any,
	inviteToken?: string
) => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/rooms/${roomId}/messages`, {
		method: 'POST',
		headers: {
			...authHeaders(token),
			...(inviteToken ? { 'X-Invite-Token': inviteToken } : {})
		},
		body: JSON.stringify(body)
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const runDream = async (token: string, body: any = {}) => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/dream/run`, {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify(body)
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const listDreams = async (token: string) => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/dream/runs`, { headers: authHeaders(token) });
	if (!res.ok) throw await res.json();
	return res.json();
};

export const addVoiceWorldNote = async (token: string, body: any) => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/voice-world/notes`, {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify(body)
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const listVoiceWorldNotes = async (token: string, userId: string) => {
	const res = await fetch(
		`${SPOCKIFY_API_BASE_URL}/voice-world/notes?user_id=${encodeURIComponent(userId)}`,
		{ headers: authHeaders(token) }
	);
	if (!res.ok) throw await res.json();
	return res.json();
};

export const voiceWorldReturn = async (token: string, body: any) => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/voice-world/return`, {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify(body)
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const startSpectacleDebate = async (token: string, body: any) => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/spectacle/debate`, {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify(body)
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const voteSpectacle = async (token: string, body: any) => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/spectacle/vote`, {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify(body)
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const listSpectacleDebates = async (token: string) => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/spectacle/debates`, {
		headers: authHeaders(token)
	});
	if (!res.ok) throw await res.json();
	return res.json();
};

export const generateBriefingVideo = async (
	token: string,
	body: { text: string; title?: string }
) => {
	const res = await fetch(`${SPOCKIFY_API_BASE_URL}/briefing/video`, {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify(body)
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({ detail: 'briefing video failed' }));
		throw err;
	}
	return res.blob();
};
