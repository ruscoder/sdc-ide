import { renderHook } from '@testing-library/react-hooks';
import { act } from 'react-dom/test-utils';
import { ensure } from 'aidbox-react/lib/utils/tests';
import { axiosInstance } from 'aidbox-react/lib/services/instance';
import { saveFHIRResource } from 'aidbox-react/lib/services/fhir';
import { isFailure, isSuccess } from 'aidbox-react/lib/libs/remoteData';
import { NutritionOrder, Patient } from 'shared/src/contrib/aidbox';
import { setData } from 'src/services/localStorage';
import { useSourceQueryDebugModal } from 'src/components/SourceQueryDebugModal/hooks';
import { updateQuestionnaire } from 'src/containers/Main/hooks';
import {
    nutritionorderData,
    patientData,
    props,
    resourceSuccess,
    resourceFailure,
    expectedPreparedSourceQueryData,
} from './resources';

async function setup() {
    const patient = ensure(await saveFHIRResource<Patient>(patientData));
    const nutritionorder = ensure(await saveFHIRResource<NutritionOrder>(nutritionorderData));
    ensure(await saveFHIRResource(resourceSuccess));
    return { patient, nutritionorder };
}

beforeEach(async () => {
    setData('fhirMode', false);
    axiosInstance.defaults.auth = {
        username: 'root',
        password: 'secret',
    };
});

test('preparedSourceQueryRD', async () => {
    await setup();
    const { result, waitFor } = renderHook(() => useSourceQueryDebugModal(props));
    await waitFor(() => isSuccess(result.current.preparedSourceQueryRD));
    const preparedSourceQueryData = ensure(result.current.preparedSourceQueryRD);
    expect(preparedSourceQueryData).toStrictEqual(expectedPreparedSourceQueryData);
});

test('bundleResultRD', async () => {
    const { nutritionorder } = await setup();
    const { result, waitFor } = renderHook(() => useSourceQueryDebugModal(props));
    await waitFor(() => isSuccess(result.current.bundleResultRD));
    const bundleResultData = ensure(result.current.bundleResultRD);
    expect(bundleResultData.entry?.[0].resource.entry?.[0].resource).toStrictEqual(nutritionorder);
});

test('onSave', async () => {
    await setup();
    const { result, waitFor } = renderHook(() => useSourceQueryDebugModal(props));
    await waitFor(() => isSuccess(result.current.bundleResultRD));

    await act(() => result.current.onSave(resourceSuccess));
    const responseMustBeSuccess = await updateQuestionnaire(resourceSuccess as any, false);
    expect(isSuccess(responseMustBeSuccess)).toBeTruthy();

    await act(() => result.current.onSave(resourceFailure));
    const responseMustBeFailure = await updateQuestionnaire(resourceFailure as any, false);
    expect(isFailure(responseMustBeFailure)).toBeTruthy();
});
