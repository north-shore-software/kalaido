/**
* This file was @generated using pocketbase-typegen
*/

import type PocketBase from 'pocketbase'
import type { RecordService } from 'pocketbase'

export const Collections = {
	Authorigins: "_authOrigins",
	Externalauths: "_externalAuths",
	Mfas: "_mfas",
	Otps: "_otps",
	Superusers: "_superusers",
	ChatConversation: "chat_conversation",
	ChatMessage: "chat_message",
	Colour: "colour",
	ColourFragment: "colour_fragment",
	Fragment: "fragment",
	FragmentAnnotation: "fragment_annotation",
	Ingest: "ingest",
	KalaidoscopeConfig: "kalaidoscope_config",
	KalaidoscopeMap: "kalaidoscope_map",
	Lens: "lens",
	LlmQueueStatus: "llm_queue_status",
	MapRun: "map_run",
	OrganizeRun: "organize_run",
	Projection: "projection",
	ProjectionSnapshot: "projection_snapshot",
	RefineProjSnapshotConversation: "refine_proj_snapshot_conversation",
	RefineReflSnapshotConversation: "refine_refl_snapshot_conversation",
	Reflection: "reflection",
	ReflectionSnapshot: "reflection_snapshot",
	Usage: "usage",
	Users: "users",
	ViewStream: "view_stream",
} as const
export type Collections = typeof Collections[keyof typeof Collections]

// Alias types for improved usability
export type IsoDateString = string
export type IsoAutoDateString = string & { readonly autodate: unique symbol }
export type RecordIdString = string
export type FileNameString = string & { readonly filename: unique symbol }
export type HTMLString = string

type ExpandType<T> = unknown extends T
	? T extends unknown
		? { expand?: unknown }
		: { expand: T }
	: { expand: T }

// System fields
export type BaseSystemFields<T = unknown> = {
	id: RecordIdString
	collectionId: string
	collectionName: Collections
} & ExpandType<T>

export type AuthSystemFields<T = unknown> = {
	email: string
	emailVisibility: boolean
	username: string
	verified: boolean
} & BaseSystemFields<T>

// Record types for each collection

export type AuthoriginsRecord = {
	collectionRef: string
	created: IsoAutoDateString
	fingerprint: string
	id: string
	recordRef: string
	updated: IsoAutoDateString
}

export type ExternalauthsRecord = {
	collectionRef: string
	created: IsoAutoDateString
	id: string
	provider: string
	providerId: string
	recordRef: string
	updated: IsoAutoDateString
}

export type MfasRecord = {
	collectionRef: string
	created: IsoAutoDateString
	id: string
	method: string
	recordRef: string
	updated: IsoAutoDateString
}

export type OtpsRecord = {
	collectionRef: string
	created: IsoAutoDateString
	id: string
	password: string
	recordRef: string
	sentTo?: string
	updated: IsoAutoDateString
}

export type SuperusersRecord = {
	created: IsoAutoDateString
	email: string
	emailVisibility?: boolean
	id: string
	password: string
	tokenKey: string
	updated: IsoAutoDateString
	verified?: boolean
}

export type ChatConversationRecord = {
	created: IsoAutoDateString
	external_conversation_id?: string
	id: string
	model?: string
}

export type ChatMessageRecord<Tcontent = unknown> = {
	chat_conversation_id?: RecordIdString
	content?: null | Tcontent
	created: IsoAutoDateString
	id: string
	model?: string
	refine_proj_conversation_id?: RecordIdString
	refine_refl_conversation_id?: RecordIdString
	updated: IsoAutoDateString
}

export type ColourRecord = {
	colour_value?: string
	created: IsoAutoDateString
	criteria?: string
	id: string
	last_provider_error_kind?: string
	name: string
	origin_node_dimension?: string
	origin_node_name?: string
	origin_run_id?: RecordIdString
	updated: IsoAutoDateString
}

export const ColourFragmentMatchTypeOptions = {
	"manual_positive": "manual_positive",
	"manual_negative": "manual_negative",
	"llm_matched_backfill": "llm_matched_backfill",
	"llm_matched_tag_on_input": "llm_matched_tag_on_input",
	"map_derived": "map_derived",
} as const
export type ColourFragmentMatchTypeOptions = typeof ColourFragmentMatchTypeOptions[keyof typeof ColourFragmentMatchTypeOptions]
export type ColourFragmentRecord = {
	colour_id: RecordIdString
	created: IsoAutoDateString
	fragment_id: RecordIdString
	id: string
	match_type: ColourFragmentMatchTypeOptions
	model?: string
}

export const FragmentTypeOptions = {
	"email": "email",
	"note": "note",
	"whatsapp": "whatsapp",
	"sms": "sms",
	"chat": "chat",
} as const
export type FragmentTypeOptions = typeof FragmentTypeOptions[keyof typeof FragmentTypeOptions]

export const FragmentOriginOptions = {
	"import": "import",
	"app": "app",
	"sync": "sync",
} as const
export type FragmentOriginOptions = typeof FragmentOriginOptions[keyof typeof FragmentOriginOptions]
export type FragmentRecord = {
	content: string
	created: IsoAutoDateString
	deleted_at?: IsoDateString
	id: string
	origin?: FragmentOriginOptions
	source?: string
	source_time?: IsoDateString
	type: FragmentTypeOptions
}

export type FragmentAnnotationRecord<Tannotation = unknown, Tconclusions = unknown, Tdecisions = unknown, Tquestions = unknown, Tthings = unknown> = {
	annotation?: null | Tannotation
	conclusions?: null | Tconclusions
	created: IsoAutoDateString
	decisions?: null | Tdecisions
	folded?: boolean
	fragment_id: RecordIdString
	grounded_count?: number
	id: string
	model?: string
	questions?: null | Tquestions
	summary?: string
	things?: null | Tthings
	title?: string
}

export type IngestRecord = {
	created: IsoAutoDateString
	error?: string
	extensions?: string
	file?: FileNameString[]
	format?: string
	id: string
	ingested?: number
	limit?: number
	organize_after?: boolean
	pipeline?: string
	pipeline_error?: string
	skip_duplicates?: boolean
	status?: string
	updated: IsoAutoDateString
}

export type KalaidoscopeConfigRecord<Trole_models = unknown> = {
	api_key?: string
	created: IsoAutoDateString
	default_model?: string
	id: string
	model_set?: string
	provider?: string
	role_models?: null | Trole_models
	updated: IsoAutoDateString
}

export type KalaidoscopeMapRecord<Tbody = unknown> = {
	annotated?: number
	body?: null | Tbody
	consolidated_at?: IsoDateString
	created: IsoAutoDateString
	fragments?: number
	id: string
	updated: IsoAutoDateString
	version?: number
}

export type LensRecord<Tcontext_spec = unknown, Tprompt = unknown> = {
	context_spec?: null | Tcontext_spec
	created: IsoAutoDateString
	created_from_proj_refinement_id?: RecordIdString
	created_from_refl_refinement_id?: RecordIdString
	id: string
	parent_lens_id?: RecordIdString
	prompt?: null | Tprompt
}

export type LlmQueueStatusRecord<Trunning = unknown, Twaiting = unknown> = {
	created: IsoAutoDateString
	id: string
	running?: null | Trunning
	state?: string
	updated: IsoAutoDateString
	waiting?: null | Twaiting
}

export const MapRunStatusOptions = {
	"running": "running",
	"done": "done",
	"error": "error",
} as const
export type MapRunStatusOptions = typeof MapRunStatusOptions[keyof typeof MapRunStatusOptions]
export type MapRunRecord = {
	admits?: number
	created: IsoAutoDateString
	error?: string
	id: string
	merges?: number
	model?: string
	pending_in?: number
	status: MapRunStatusOptions
	updated: IsoAutoDateString
	version_after?: number
	version_before?: number
}

export const OrganizeRunStatusOptions = {
	"running": "running",
	"done": "done",
	"error": "error",
} as const
export type OrganizeRunStatusOptions = typeof OrganizeRunStatusOptions[keyof typeof OrganizeRunStatusOptions]
export type OrganizeRunRecord<Tentities = unknown, Twarnings = unknown> = {
	created: IsoAutoDateString
	entities?: null | Tentities
	error?: string
	explorations?: number
	id: string
	map_version?: number
	model?: string
	status: OrganizeRunStatusOptions
	updated: IsoAutoDateString
	warnings?: null | Twarnings
}

export type ProjectionRecord<Tcurrent_context_spec = unknown> = {
	brief?: string
	created: IsoAutoDateString
	current_context_spec?: null | Tcurrent_context_spec
	current_lens_id?: RecordIdString
	id: string
	model?: string
	name?: string
	origin_run_id?: RecordIdString
	pinned_by?: RecordIdString
	updated: IsoAutoDateString
}

export type ProjectionSnapshotRecord<Tcontext_spec = unknown, Toutput = unknown, Tresolved_context = unknown> = {
	approval_sequence_number?: number
	approval_timestamp?: IsoDateString
	chain_origin?: string
	context_spec?: null | Tcontext_spec
	created: IsoAutoDateString
	created_from_refinement_id?: RecordIdString
	generation_timestamp?: IsoDateString
	id: string
	lens_id?: RecordIdString
	model?: string
	output?: null | Toutput
	projection_id: RecordIdString
	resolved_context?: null | Tresolved_context
	status?: string
	updated: IsoAutoDateString
}

export type RefineProjSnapshotConversationRecord = {
	created: IsoAutoDateString
	external_conversation_id?: string
	id: string
	projection_id?: RecordIdString
	projection_snapshot_id?: RecordIdString
}

export type RefineReflSnapshotConversationRecord = {
	created: IsoAutoDateString
	external_conversation_id?: string
	id: string
	reflection_id?: RecordIdString
	reflection_snapshot_id?: RecordIdString
}

export type ReflectionRecord<Tcurrent_context_spec = unknown, Twindow_spec_versions = unknown> = {
	brief?: string
	created: IsoAutoDateString
	current_context_spec?: null | Tcurrent_context_spec
	current_lens_id?: RecordIdString
	id: string
	model?: string
	name?: string
	origin_run_id?: RecordIdString
	pinned_by?: RecordIdString
	updated: IsoAutoDateString
	window_spec_versions?: null | Twindow_spec_versions
}

export type ReflectionSnapshotRecord<Tcontext_spec = unknown, Toutput = unknown, Tresolved_context = unknown, Tresolved_window = unknown, Twindow_spec = unknown> = {
	approval_sequence_number?: number
	approval_timestamp?: IsoDateString
	chain_origin?: string
	context_spec?: null | Tcontext_spec
	created: IsoAutoDateString
	created_from_refinement_id?: RecordIdString
	generation_timestamp?: IsoDateString
	id: string
	lens_id?: RecordIdString
	model?: string
	output?: null | Toutput
	reflection_id: RecordIdString
	resolved_context?: null | Tresolved_context
	resolved_window?: null | Tresolved_window
	status?: string
	updated: IsoAutoDateString
	window_key?: string
	window_spec?: null | Twindow_spec
	window_spec_version_number?: number
}

export type UsageRecord = {
	cached_tokens?: number
	completion_tokens?: number
	created: IsoAutoDateString
	id: string
	period: string
	prompt_tokens?: number
	total_tokens?: number
	updated: IsoAutoDateString
}

export type UsersRecord = {
	avatar?: FileNameString
	created: IsoAutoDateString
	email: string
	emailVisibility?: boolean
	id: string
	name?: string
	password: string
	tokenKey: string
	updated: IsoAutoDateString
	verified?: boolean
}

export const ViewStreamTypeOptions = {
	"email": "email",
	"note": "note",
	"whatsapp": "whatsapp",
	"sms": "sms",
	"chat": "chat",
} as const
export type ViewStreamTypeOptions = typeof ViewStreamTypeOptions[keyof typeof ViewStreamTypeOptions]
export type ViewStreamRecord<Tcolours = unknown> = {
	colours?: null | Tcolours
	content: string
	created: IsoAutoDateString
	id: string
	source_time?: IsoDateString
	type: ViewStreamTypeOptions
}

// Response types include system fields and match responses from the PocketBase API
export type AuthoriginsResponse<Texpand = unknown> = Required<AuthoriginsRecord> & BaseSystemFields<Texpand>
export type ExternalauthsResponse<Texpand = unknown> = Required<ExternalauthsRecord> & BaseSystemFields<Texpand>
export type MfasResponse<Texpand = unknown> = Required<MfasRecord> & BaseSystemFields<Texpand>
export type OtpsResponse<Texpand = unknown> = Required<OtpsRecord> & BaseSystemFields<Texpand>
export type SuperusersResponse<Texpand = unknown> = Required<SuperusersRecord> & AuthSystemFields<Texpand>
export type ChatConversationResponse<Texpand = unknown> = Required<ChatConversationRecord> & BaseSystemFields<Texpand>
export type ChatMessageResponse<Tcontent = unknown, Texpand = unknown> = Required<ChatMessageRecord<Tcontent>> & BaseSystemFields<Texpand>
export type ColourResponse<Texpand = unknown> = Required<ColourRecord> & BaseSystemFields<Texpand>
export type ColourFragmentResponse<Texpand = unknown> = Required<ColourFragmentRecord> & BaseSystemFields<Texpand>
export type FragmentResponse<Texpand = unknown> = Required<FragmentRecord> & BaseSystemFields<Texpand>
export type FragmentAnnotationResponse<Tannotation = unknown, Tconclusions = unknown, Tdecisions = unknown, Tquestions = unknown, Tthings = unknown, Texpand = unknown> = Required<FragmentAnnotationRecord<Tannotation, Tconclusions, Tdecisions, Tquestions, Tthings>> & BaseSystemFields<Texpand>
export type IngestResponse<Texpand = unknown> = Required<IngestRecord> & BaseSystemFields<Texpand>
export type KalaidoscopeConfigResponse<Trole_models = unknown, Texpand = unknown> = Required<KalaidoscopeConfigRecord<Trole_models>> & BaseSystemFields<Texpand>
export type KalaidoscopeMapResponse<Tbody = unknown, Texpand = unknown> = Required<KalaidoscopeMapRecord<Tbody>> & BaseSystemFields<Texpand>
export type LensResponse<Tcontext_spec = unknown, Tprompt = unknown, Texpand = unknown> = Required<LensRecord<Tcontext_spec, Tprompt>> & BaseSystemFields<Texpand>
export type LlmQueueStatusResponse<Trunning = unknown, Twaiting = unknown, Texpand = unknown> = Required<LlmQueueStatusRecord<Trunning, Twaiting>> & BaseSystemFields<Texpand>
export type MapRunResponse<Texpand = unknown> = Required<MapRunRecord> & BaseSystemFields<Texpand>
export type OrganizeRunResponse<Tentities = unknown, Twarnings = unknown, Texpand = unknown> = Required<OrganizeRunRecord<Tentities, Twarnings>> & BaseSystemFields<Texpand>
export type ProjectionResponse<Tcurrent_context_spec = unknown, Texpand = unknown> = Required<ProjectionRecord<Tcurrent_context_spec>> & BaseSystemFields<Texpand>
export type ProjectionSnapshotResponse<Tcontext_spec = unknown, Toutput = unknown, Tresolved_context = unknown, Texpand = unknown> = Required<ProjectionSnapshotRecord<Tcontext_spec, Toutput, Tresolved_context>> & BaseSystemFields<Texpand>
export type RefineProjSnapshotConversationResponse<Texpand = unknown> = Required<RefineProjSnapshotConversationRecord> & BaseSystemFields<Texpand>
export type RefineReflSnapshotConversationResponse<Texpand = unknown> = Required<RefineReflSnapshotConversationRecord> & BaseSystemFields<Texpand>
export type ReflectionResponse<Tcurrent_context_spec = unknown, Twindow_spec_versions = unknown, Texpand = unknown> = Required<ReflectionRecord<Tcurrent_context_spec, Twindow_spec_versions>> & BaseSystemFields<Texpand>
export type ReflectionSnapshotResponse<Tcontext_spec = unknown, Toutput = unknown, Tresolved_context = unknown, Tresolved_window = unknown, Twindow_spec = unknown, Texpand = unknown> = Required<ReflectionSnapshotRecord<Tcontext_spec, Toutput, Tresolved_context, Tresolved_window, Twindow_spec>> & BaseSystemFields<Texpand>
export type UsageResponse<Texpand = unknown> = Required<UsageRecord> & BaseSystemFields<Texpand>
export type UsersResponse<Texpand = unknown> = Required<UsersRecord> & AuthSystemFields<Texpand>
export type ViewStreamResponse<Tcolours = unknown, Texpand = unknown> = Required<ViewStreamRecord<Tcolours>> & BaseSystemFields<Texpand>

// Types containing all Records and Responses, useful for creating typing helper functions

export type CollectionRecords = {
	_authOrigins: AuthoriginsRecord
	_externalAuths: ExternalauthsRecord
	_mfas: MfasRecord
	_otps: OtpsRecord
	_superusers: SuperusersRecord
	chat_conversation: ChatConversationRecord
	chat_message: ChatMessageRecord
	colour: ColourRecord
	colour_fragment: ColourFragmentRecord
	fragment: FragmentRecord
	fragment_annotation: FragmentAnnotationRecord
	ingest: IngestRecord
	kalaidoscope_config: KalaidoscopeConfigRecord
	kalaidoscope_map: KalaidoscopeMapRecord
	lens: LensRecord
	llm_queue_status: LlmQueueStatusRecord
	map_run: MapRunRecord
	organize_run: OrganizeRunRecord
	projection: ProjectionRecord
	projection_snapshot: ProjectionSnapshotRecord
	refine_proj_snapshot_conversation: RefineProjSnapshotConversationRecord
	refine_refl_snapshot_conversation: RefineReflSnapshotConversationRecord
	reflection: ReflectionRecord
	reflection_snapshot: ReflectionSnapshotRecord
	usage: UsageRecord
	users: UsersRecord
	view_stream: ViewStreamRecord
}

export type CollectionResponses = {
	_authOrigins: AuthoriginsResponse
	_externalAuths: ExternalauthsResponse
	_mfas: MfasResponse
	_otps: OtpsResponse
	_superusers: SuperusersResponse
	chat_conversation: ChatConversationResponse
	chat_message: ChatMessageResponse
	colour: ColourResponse
	colour_fragment: ColourFragmentResponse
	fragment: FragmentResponse
	fragment_annotation: FragmentAnnotationResponse
	ingest: IngestResponse
	kalaidoscope_config: KalaidoscopeConfigResponse
	kalaidoscope_map: KalaidoscopeMapResponse
	lens: LensResponse
	llm_queue_status: LlmQueueStatusResponse
	map_run: MapRunResponse
	organize_run: OrganizeRunResponse
	projection: ProjectionResponse
	projection_snapshot: ProjectionSnapshotResponse
	refine_proj_snapshot_conversation: RefineProjSnapshotConversationResponse
	refine_refl_snapshot_conversation: RefineReflSnapshotConversationResponse
	reflection: ReflectionResponse
	reflection_snapshot: ReflectionSnapshotResponse
	usage: UsageResponse
	users: UsersResponse
	view_stream: ViewStreamResponse
}

// Utility types for create/update operations

type ProcessCreateAndUpdateFields<T> = Omit<{
	// Omit AutoDate fields
	[K in keyof T as Extract<T[K], IsoAutoDateString> extends never ? K : never]: 
		// Convert FileNameString to File
		T[K] extends infer U ? 
			U extends (FileNameString | FileNameString[]) ? 
				U extends any[] ? File[] : File 
			: U
		: never
}, 'id'>

// Create type for Auth collections
export type CreateAuth<T> = {
	id?: RecordIdString
	email: string
	emailVisibility?: boolean
	password: string
	passwordConfirm: string
	verified?: boolean
} & ProcessCreateAndUpdateFields<T>

// Create type for Base collections
export type CreateBase<T> = {
	id?: RecordIdString
} & ProcessCreateAndUpdateFields<T>

// Update type for Auth collections
export type UpdateAuth<T> = Partial<
	Omit<ProcessCreateAndUpdateFields<T>, keyof AuthSystemFields>
> & {
	email?: string
	emailVisibility?: boolean
	oldPassword?: string
	password?: string
	passwordConfirm?: string
	verified?: boolean
}

// Update type for Base collections
export type UpdateBase<T> = Partial<
	Omit<ProcessCreateAndUpdateFields<T>, keyof BaseSystemFields>
>

// Get the correct create type for any collection
export type Create<T extends keyof CollectionResponses> =
	CollectionResponses[T] extends AuthSystemFields
		? CreateAuth<CollectionRecords[T]>
		: CreateBase<CollectionRecords[T]>

// Get the correct update type for any collection
export type Update<T extends keyof CollectionResponses> =
	CollectionResponses[T] extends AuthSystemFields
		? UpdateAuth<CollectionRecords[T]>
		: UpdateBase<CollectionRecords[T]>

// Type for usage with type asserted PocketBase instance
// https://github.com/pocketbase/js-sdk#specify-typescript-definitions

export type TypedPocketBase = {
	collection<T extends keyof CollectionResponses>(
		idOrName: T
	): RecordService<CollectionResponses[T]>
} & PocketBase
