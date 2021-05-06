/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorInput, Verbosity, GroupIdentifier, IEditorInput, IRevertOptions, IEditorInputWithPreferredResource } from 'vs/workbench/common/editor';
import { URI } from 'vs/base/common/uri';
import { ITextFileService, ITextFileSaveOptions, IModeSupport } from 'vs/workbench/services/textfile/common/textfiles';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IFileService, FileSystemProviderCapabilities } from 'vs/platform/files/common/files';
import { ILabelService } from 'vs/platform/label/common/label';
import { IFilesConfigurationService } from 'vs/workbench/services/filesConfiguration/common/filesConfigurationService';
import { Schemas } from 'vs/base/common/network';
import { dirname, isEqual } from 'vs/base/common/resources';
import { ITextEditorModel, ITextModelService } from 'vs/editor/common/services/resolverService';
import { TextResourceEditorModel } from 'vs/workbench/common/editor/textResourceEditorModel';
import { IReference } from 'vs/base/common/lifecycle';

/**
 * The base class for all editor inputs that open in text editors.
 */
export abstract class AbstractTextResourceEditorInput extends EditorInput implements IEditorInputWithPreferredResource {

	private _preferredResource: URI;
	get preferredResource(): URI { return this._preferredResource; }

	constructor(
		public readonly resource: URI,
		preferredResource: URI | undefined,
		@IEditorService protected readonly editorService: IEditorService,
		@IEditorGroupsService protected readonly editorGroupService: IEditorGroupsService,
		@ITextFileService protected readonly textFileService: ITextFileService,
		@ILabelService protected readonly labelService: ILabelService,
		@IFileService protected readonly fileService: IFileService,
		@IFilesConfigurationService protected readonly filesConfigurationService: IFilesConfigurationService
	) {
		super();

		this._preferredResource = preferredResource || resource;

		this.registerListeners();
	}

	protected registerListeners(): void {

		// Clear label memoizer on certain events that have impact
		this._register(this.labelService.onDidChangeFormatters(e => this.onLabelEvent(e.scheme)));
		this._register(this.fileService.onDidChangeFileSystemProviderRegistrations(e => this.onLabelEvent(e.scheme)));
		this._register(this.fileService.onDidChangeFileSystemProviderCapabilities(e => this.onLabelEvent(e.scheme)));
	}

	private onLabelEvent(scheme: string): void {
		if (scheme === this._preferredResource.scheme) {
			this.updateLabel();
		}
	}

	private updateLabel(): void {

		// Clear any cached labels from before
		this._name = undefined;
		this._shortDescription = undefined;
		this._mediumDescription = undefined;
		this._longDescription = undefined;
		this._shortTitle = undefined;
		this._mediumTitle = undefined;
		this._longTitle = undefined;

		// Trigger recompute of label
		this._onDidChangeLabel.fire();
	}

	setPreferredResource(preferredResource: URI): void {
		if (!isEqual(preferredResource, this._preferredResource)) {
			this._preferredResource = preferredResource;

			this.updateLabel();
		}
	}

	private _name: string | undefined = undefined;
	override getName(): string {
		if (typeof this._name !== 'string') {
			this._name = this.labelService.getUriBasenameLabel(this._preferredResource);
		}

		return this._name;
	}

	override getDescription(verbosity: Verbosity = Verbosity.MEDIUM): string | undefined {
		switch (verbosity) {
			case Verbosity.SHORT:
				return this.shortDescription;
			case Verbosity.LONG:
				return this.longDescription;
			case Verbosity.MEDIUM:
			default:
				return this.mediumDescription;
		}
	}

	private _shortDescription: string | undefined = undefined;
	private get shortDescription(): string {
		if (typeof this._shortDescription !== 'string') {
			this._shortDescription = this.labelService.getUriBasenameLabel(dirname(this._preferredResource));
		}

		return this._shortDescription;
	}

	private _mediumDescription: string | undefined = undefined;
	private get mediumDescription(): string {
		if (typeof this._mediumDescription !== 'string') {
			this._mediumDescription = this.labelService.getUriLabel(dirname(this._preferredResource), { relative: true });
		}

		return this._mediumDescription;
	}

	private _longDescription: string | undefined = undefined;
	private get longDescription(): string {
		if (typeof this._longDescription !== 'string') {
			this._longDescription = this.labelService.getUriLabel(dirname(this._preferredResource));
		}

		return this._longDescription;
	}

	private _shortTitle: string | undefined = undefined;
	private get shortTitle(): string {
		if (typeof this._shortTitle !== 'string') {
			this._shortTitle = this.getName();
		}

		return this._shortTitle;
	}

	private _mediumTitle: string | undefined = undefined;
	private get mediumTitle(): string {
		if (typeof this._mediumTitle !== 'string') {
			this._mediumTitle = this.labelService.getUriLabel(this._preferredResource, { relative: true });
		}

		return this._mediumTitle;
	}

	private _longTitle: string | undefined = undefined;
	private get longTitle(): string {
		if (typeof this._longTitle !== 'string') {
			this._longTitle = this.labelService.getUriLabel(this._preferredResource);
		}

		return this._longTitle;
	}

	override getTitle(verbosity: Verbosity): string {
		switch (verbosity) {
			case Verbosity.SHORT:
				return this.shortTitle;
			case Verbosity.LONG:
				return this.longTitle;
			default:
			case Verbosity.MEDIUM:
				return this.mediumTitle;
		}
	}

	override isUntitled(): boolean {
		//  any file: is never untitled as it can be saved
		//  untitled: is untitled by definition
		// any other: is untitled because it cannot be saved, as such we expect a "Save As" dialog
		return !this.fileService.canHandleResource(this.resource);
	}

	override isReadonly(): boolean {
		if (this.isUntitled()) {
			return false; // untitled is never readonly
		}

		return this.fileService.hasCapability(this.resource, FileSystemProviderCapabilities.Readonly);
	}

	override save(group: GroupIdentifier, options?: ITextFileSaveOptions): Promise<IEditorInput | undefined> {

		// If this is neither an `untitled` resource, nor a resource
		// we can handle with the file service, we can only "Save As..."
		if (this.resource.scheme !== Schemas.untitled && !this.fileService.canHandleResource(this.resource)) {
			return this.saveAs(group, options);
		}

		// Normal save
		return this.doSave(options, false);
	}

	override saveAs(group: GroupIdentifier, options?: ITextFileSaveOptions): Promise<IEditorInput | undefined> {
		return this.doSave(options, true);
	}

	private async doSave(options: ITextFileSaveOptions | undefined, saveAs: boolean): Promise<IEditorInput | undefined> {

		// Save / Save As
		let target: URI | undefined;
		if (saveAs) {
			target = await this.textFileService.saveAs(this.resource, undefined, { ...options, suggestedTarget: this.preferredResource });
		} else {
			target = await this.textFileService.save(this.resource, options);
		}

		if (!target) {
			return undefined; // save cancelled
		}

		// If this save operation results in a new editor, either
		// because it was saved to disk (e.g. from untitled) or
		// through an explicit "Save As", make sure to replace it.
		if (
			target.scheme !== this.resource.scheme ||
			(saveAs && !isEqual(target, this.preferredResource))
		) {
			return this.editorService.createEditorInput({ resource: target });
		}

		return this;
	}

	override async revert(group: GroupIdentifier, options?: IRevertOptions): Promise<void> {
		await this.textFileService.revert(this.resource, options);
	}
}

/**
 * A read-only text editor input whos contents are made of the provided resource that points to an existing
 * code editor model.
 */
export class TextResourceEditorInput extends AbstractTextResourceEditorInput implements IModeSupport {

	static readonly ID: string = 'workbench.editors.resourceEditorInput';

	override get typeId(): string {
		return TextResourceEditorInput.ID;
	}

	private cachedModel: TextResourceEditorModel | undefined = undefined;
	private modelReference: Promise<IReference<ITextEditorModel>> | undefined = undefined;

	constructor(
		resource: URI,
		private name: string | undefined,
		private description: string | undefined,
		private preferredMode: string | undefined,
		@ITextModelService private readonly textModelResolverService: ITextModelService,
		@ITextFileService textFileService: ITextFileService,
		@IEditorService editorService: IEditorService,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@IFileService fileService: IFileService,
		@ILabelService labelService: ILabelService,
		@IFilesConfigurationService filesConfigurationService: IFilesConfigurationService
	) {
		super(resource, undefined, editorService, editorGroupService, textFileService, labelService, fileService, filesConfigurationService);
	}

	override getName(): string {
		return this.name || super.getName();
	}

	setName(name: string): void {
		if (this.name !== name) {
			this.name = name;

			this._onDidChangeLabel.fire();
		}
	}

	override getDescription(): string | undefined {
		return this.description;
	}

	setDescription(description: string): void {
		if (this.description !== description) {
			this.description = description;

			this._onDidChangeLabel.fire();
		}
	}

	setMode(mode: string): void {
		this.setPreferredMode(mode);

		if (this.cachedModel) {
			this.cachedModel.setMode(mode);
		}
	}

	setPreferredMode(mode: string): void {
		this.preferredMode = mode;
	}

	override async resolve(): Promise<ITextEditorModel> {
		if (!this.modelReference) {
			this.modelReference = this.textModelResolverService.createModelReference(this.resource);
		}

		const ref = await this.modelReference;

		// Ensure the resolved model is of expected type
		const model = ref.object;
		if (!(model instanceof TextResourceEditorModel)) {
			ref.dispose();
			this.modelReference = undefined;

			throw new Error(`Unexpected model for TextResourceEditorInput: ${this.resource}`);
		}

		this.cachedModel = model;

		// Set mode if we have a preferred mode configured
		if (this.preferredMode) {
			model.setMode(this.preferredMode);
		}

		return model;
	}

	override matches(otherInput: unknown): boolean {
		if (otherInput === this) {
			return true;
		}

		if (otherInput instanceof TextResourceEditorInput) {
			return isEqual(otherInput.resource, this.resource);
		}

		return false;
	}

	override dispose(): void {
		if (this.modelReference) {
			this.modelReference.then(ref => ref.dispose());
			this.modelReference = undefined;
		}

		this.cachedModel = undefined;

		super.dispose();
	}
}
