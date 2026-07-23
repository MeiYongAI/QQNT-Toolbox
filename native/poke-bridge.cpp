#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <tlhelp32.h>

#include <cstddef>
#include <cstdint>
#include <cstring>

struct napi_env__;
struct napi_value__;
struct napi_callback_info__;

using napi_env = napi_env__*;
using napi_value = napi_value__*;
using napi_callback_info = napi_callback_info__*;
using napi_callback = napi_value(__cdecl*)(napi_env, napi_callback_info);
using napi_status = int;

namespace {

constexpr napi_status NAPI_OK = 0;
constexpr std::size_t PATCH_SIZE = 15;
constexpr std::size_t SIGNATURE_SIZE = 48;

using NapiCreateFunction = napi_status(__cdecl*)(
    napi_env, const char*, std::size_t, napi_callback, void*, napi_value*);
using NapiSetNamedProperty = napi_status(__cdecl*)(napi_env, napi_value, const char*, napi_value);
using NapiCreateInt32 = napi_status(__cdecl*)(napi_env, std::int32_t, napi_value*);
using NapiIsBuffer = napi_status(__cdecl*)(napi_env, napi_value, bool*);
using NapiGetBufferInfo = napi_status(__cdecl*)(napi_env, napi_value, void**, std::size_t*);
using NapiCreateStringLatin1 = napi_status(__cdecl*)(
    napi_env, const char*, std::size_t, napi_value*);
using NapiGetCallbackInfo = napi_status(__cdecl*)(
    napi_env, napi_callback_info, std::size_t*, napi_value*, napi_value*, void**);
using NapiGetValueInt32 = napi_status(__cdecl*)(napi_env, napi_value, std::int32_t*);

struct NapiApi {
    NapiCreateFunction createFunction = nullptr;
    NapiSetNamedProperty setNamedProperty = nullptr;
    NapiCreateInt32 createInt32 = nullptr;
    NapiIsBuffer isBuffer = nullptr;
    NapiGetBufferInfo getBufferInfo = nullptr;
    NapiCreateStringLatin1 createStringLatin1 = nullptr;
    NapiGetCallbackInfo getCallbackInfo = nullptr;
    NapiGetValueInt32 getValueInt32 = nullptr;
};

struct InternalString {
    std::uint64_t capacityTag;
    std::uint64_t size;
    std::uint8_t* data;
};

using ConvertValue = InternalString*(__fastcall*)(InternalString*, napi_env, napi_value);

NapiApi g_napi;
ConvertValue g_originalConvert = nullptr;
std::uint8_t* g_target = nullptr;
volatile LONG g_conversionArmed = 0;
HWND g_moveWindow = nullptr;
RECT g_moveOrigin = {};
UINT g_moveDpi = USER_DEFAULT_SCREEN_DPI;

constexpr std::size_t MAX_INTERCEPTED_BUFFER_SIZE = 4096;

struct SuspendedThread {
    HANDLE handle;
};

constexpr std::uint8_t EXPECTED_SIGNATURE[SIGNATURE_SIZE] = {
    0x55, 0x41, 0x56, 0x56, 0x57, 0x53, 0x48, 0x83,
    0xEC, 0x60, 0x48, 0x8D, 0x6C, 0x24, 0x60, 0x48,
    0xC7, 0x45, 0xF8, 0xFE, 0xFF, 0xFF, 0xFF, 0x4C,
    0x89, 0xC7, 0x48, 0x89, 0xD6, 0x49, 0x89, 0xCE,
    0x48, 0x8D, 0x5D, 0xCC, 0x83, 0x23, 0x00, 0x48,
    0x89, 0xD1, 0x4C, 0x89, 0xC2, 0x49, 0x89, 0xD8
};

template <typename T>
T resolveNapi(const char* name) {
    HMODULE executable = GetModuleHandleW(nullptr);
    return executable ? reinterpret_cast<T>(GetProcAddress(executable, name)) : nullptr;
}

bool resolveNapiApi() {
    g_napi.createFunction = resolveNapi<NapiCreateFunction>("napi_create_function");
    g_napi.setNamedProperty = resolveNapi<NapiSetNamedProperty>("napi_set_named_property");
    g_napi.createInt32 = resolveNapi<NapiCreateInt32>("napi_create_int32");
    g_napi.isBuffer = resolveNapi<NapiIsBuffer>("napi_is_buffer");
    g_napi.getBufferInfo = resolveNapi<NapiGetBufferInfo>("napi_get_buffer_info");
    g_napi.createStringLatin1 =
        resolveNapi<NapiCreateStringLatin1>("napi_create_string_latin1");
    g_napi.getCallbackInfo = resolveNapi<NapiGetCallbackInfo>("napi_get_cb_info");
    g_napi.getValueInt32 = resolveNapi<NapiGetValueInt32>("napi_get_value_int32");
    return g_napi.createFunction && g_napi.setNamedProperty && g_napi.createInt32 && g_napi.isBuffer &&
        g_napi.getBufferInfo && g_napi.createStringLatin1 && g_napi.getCallbackInfo &&
        g_napi.getValueInt32;
}

bool getModuleSize(HMODULE module, std::uint32_t& size) {
    if (!module) {
        return false;
    }
    const auto* base = reinterpret_cast<const std::uint8_t*>(module);
    const auto* dos = reinterpret_cast<const IMAGE_DOS_HEADER*>(base);
    if (dos->e_magic != IMAGE_DOS_SIGNATURE || dos->e_lfanew <= 0) {
        return false;
    }
    const auto* nt = reinterpret_cast<const IMAGE_NT_HEADERS64*>(base + dos->e_lfanew);
    if (nt->Signature != IMAGE_NT_SIGNATURE ||
        nt->OptionalHeader.Magic != IMAGE_NT_OPTIONAL_HDR64_MAGIC) {
        return false;
    }
    size = nt->OptionalHeader.SizeOfImage;
    return size > 0;
}

std::uint8_t* findUniqueConvertTarget(HMODULE module, std::uint32_t imageSize) {
    const auto* base = reinterpret_cast<const std::uint8_t*>(module);
    const auto* dos = reinterpret_cast<const IMAGE_DOS_HEADER*>(base);
    const auto* nt = reinterpret_cast<const IMAGE_NT_HEADERS64*>(base + dos->e_lfanew);
    const auto& directory = nt->OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_EXCEPTION];
    if (directory.VirtualAddress == 0 || directory.Size < sizeof(RUNTIME_FUNCTION) ||
        directory.VirtualAddress > imageSize || directory.Size > imageSize - directory.VirtualAddress) {
        return nullptr;
    }

    const auto* functions = reinterpret_cast<const RUNTIME_FUNCTION*>(base + directory.VirtualAddress);
    const std::size_t count = directory.Size / sizeof(RUNTIME_FUNCTION);
    std::uint8_t* found = nullptr;
    for (std::size_t index = 0; index < count; index += 1) {
        const auto& function = functions[index];
        if (function.EndAddress <= function.BeginAddress || function.EndAddress > imageSize ||
            function.BeginAddress > imageSize - SIGNATURE_SIZE ||
            function.EndAddress - function.BeginAddress < SIGNATURE_SIZE) {
            continue;
        }
        auto* candidate = const_cast<std::uint8_t*>(base + function.BeginAddress);
        if (std::memcmp(candidate, EXPECTED_SIGNATURE, SIGNATURE_SIZE) != 0) {
            continue;
        }
        if (found) {
            return nullptr;
        }
        found = candidate;
    }
    return found;
}

void writeAbsoluteJump(std::uint8_t* destination, const void* target) {
    destination[0] = 0x48;
    destination[1] = 0xB8;
    const auto address = reinterpret_cast<std::uintptr_t>(target);
    std::memcpy(destination + 2, &address, sizeof(address));
    destination[10] = 0xFF;
    destination[11] = 0xE0;
}

std::size_t suspendOtherThreads(
    SuspendedThread* suspended,
    std::size_t capacity,
    const std::uint8_t* target,
    const std::uint8_t* trampoline) {
    HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
    if (snapshot == INVALID_HANDLE_VALUE) {
        return static_cast<std::size_t>(-1);
    }

    const DWORD processId = GetCurrentProcessId();
    const DWORD currentThreadId = GetCurrentThreadId();
    std::size_t count = 0;
    THREADENTRY32 entry = {};
    entry.dwSize = sizeof(entry);
    if (Thread32First(snapshot, &entry)) {
        do {
            if (entry.th32OwnerProcessID != processId || entry.th32ThreadID == currentThreadId) {
                continue;
            }
            HANDLE thread = OpenThread(
                THREAD_SUSPEND_RESUME | THREAD_GET_CONTEXT | THREAD_SET_CONTEXT | THREAD_QUERY_INFORMATION,
                FALSE,
                entry.th32ThreadID);
            if (!thread) {
                continue;
            }
            if (count == capacity || SuspendThread(thread) == static_cast<DWORD>(-1)) {
                CloseHandle(thread);
                continue;
            }

            CONTEXT context = {};
            context.ContextFlags = CONTEXT_CONTROL;
            if (!GetThreadContext(thread, &context)) {
                ResumeThread(thread);
                CloseHandle(thread);
                continue;
            }
            const auto instruction = reinterpret_cast<const std::uint8_t*>(context.Rip);
            if (instruction >= target && instruction < target + PATCH_SIZE) {
                context.Rip = reinterpret_cast<DWORD64>(
                    trampoline + (instruction - target));
                if (!SetThreadContext(thread, &context)) {
                    ResumeThread(thread);
                    CloseHandle(thread);
                    continue;
                }
            }
            suspended[count++].handle = thread;
        } while (Thread32Next(snapshot, &entry));
    }
    CloseHandle(snapshot);
    return count;
}

void resumeThreads(SuspendedThread* suspended, std::size_t count) {
    while (count > 0) {
        HANDLE thread = suspended[--count].handle;
        ResumeThread(thread);
        CloseHandle(thread);
    }
}

bool getBufferView(napi_env env, napi_value value, void*& data, std::size_t& length) {
    bool isBuffer = false;
    return g_napi.isBuffer(env, value, &isBuffer) == NAPI_OK && isBuffer &&
        g_napi.getBufferInfo(env, value, &data, &length) == NAPI_OK;
}

InternalString* __fastcall convertValueHook(
    InternalString* output,
    napi_env env,
    napi_value value) {
    void* source = nullptr;
    std::size_t length = 0;
    if (!getBufferView(env, value, source, length)) {
        return g_originalConvert(output, env, value);
    }
    if (InterlockedCompareExchange(&g_conversionArmed, 0, 1) != 1 ||
        length > MAX_INTERCEPTED_BUFFER_SIZE) {
        return g_originalConvert(output, env, value);
    }
    if (!output || (length > 0 && !source)) {
        return nullptr;
    }

    char placeholder[MAX_INTERCEPTED_BUFFER_SIZE];
    std::memset(placeholder, 'A', length);
    napi_value placeholderValue = nullptr;
    if (g_napi.createStringLatin1(env, placeholder, length, &placeholderValue) != NAPI_OK ||
        !placeholderValue) {
        return g_originalConvert(output, env, value);
    }

    InternalString* converted = g_originalConvert(output, env, placeholderValue);
    if (!converted) {
        return nullptr;
    }

    const auto tag = *reinterpret_cast<const std::uint8_t*>(converted);
    std::uint8_t* destination = nullptr;
    if ((tag & 1) != 0) {
        if (converted->size != length || !converted->data) {
            return nullptr;
        }
        destination = converted->data;
    } else {
        if (static_cast<std::size_t>(tag >> 1) != length) {
            return nullptr;
        }
        destination = reinterpret_cast<std::uint8_t*>(converted) + 1;
    }
    if (length > 0) {
        std::memcpy(destination, source, length);
    }
    destination[length] = 0;
    return converted;
}

int installHook() {
    if (g_target) {
        return 2;
    }
    HMODULE wrapper = GetModuleHandleW(L"wrapper.node");
    std::uint32_t imageSize = 0;
    if (!getModuleSize(wrapper, imageSize)) {
        return -3;
    }
    if (imageSize < SIGNATURE_SIZE) {
        return -4;
    }

    auto* target = findUniqueConvertTarget(wrapper, imageSize);
    if (!target) {
        return -5;
    }

    constexpr std::size_t trampolineSize = PATCH_SIZE + 12;
    auto* trampoline = static_cast<std::uint8_t*>(VirtualAlloc(
        nullptr,
        trampolineSize,
        MEM_COMMIT | MEM_RESERVE,
        PAGE_EXECUTE_READWRITE));
    if (!trampoline) {
        return -6;
    }
    std::memcpy(trampoline, target, PATCH_SIZE);
    writeAbsoluteJump(trampoline + PATCH_SIZE, target + PATCH_SIZE);

    g_originalConvert = reinterpret_cast<ConvertValue>(trampoline);

    SuspendedThread suspended[1024] = {};
    const std::size_t suspendedCount = suspendOtherThreads(
        suspended,
        sizeof(suspended) / sizeof(suspended[0]),
        target,
        trampoline);
    if (suspendedCount == static_cast<std::size_t>(-1)) {
        g_originalConvert = nullptr;
        VirtualFree(trampoline, 0, MEM_RELEASE);
        return -7;
    }

    DWORD oldProtection = 0;
    if (!VirtualProtect(target, PATCH_SIZE, PAGE_EXECUTE_READWRITE, &oldProtection)) {
        resumeThreads(suspended, suspendedCount);
        g_originalConvert = nullptr;
        VirtualFree(trampoline, 0, MEM_RELEASE);
        return -8;
    }
    writeAbsoluteJump(target, reinterpret_cast<const void*>(&convertValueHook));
    std::memset(target + 12, 0x90, PATCH_SIZE - 12);
    FlushInstructionCache(GetCurrentProcess(), target, PATCH_SIZE);
    DWORD ignored = 0;
    VirtualProtect(target, PATCH_SIZE, oldProtection, &ignored);
    resumeThreads(suspended, suspendedCount);

    g_target = target;
    return 1;
}

napi_value __cdecl install(napi_env env, napi_callback_info) {
    const std::int32_t result = installHook();
    napi_value value = nullptr;
    g_napi.createInt32(env, result, &value);
    return value;
}

napi_value __cdecl armConversion(napi_env, napi_callback_info) {
    InterlockedExchange(&g_conversionArmed, 1);
    return nullptr;
}

napi_value __cdecl disarmConversion(napi_env, napi_callback_info) {
    InterlockedExchange(&g_conversionArmed, 0);
    return nullptr;
}

napi_value createInt32Result(napi_env env, std::int32_t result) {
    napi_value value = nullptr;
    g_napi.createInt32(env, result, &value);
    return value;
}

bool readWindowHandle(napi_env env, napi_value value, HWND& window) {
    void* handleData = nullptr;
    std::size_t handleLength = 0;
    if (!getBufferView(env, value, handleData, handleLength) ||
        !handleData || handleLength < sizeof(HWND)) {
        return false;
    }
    std::memcpy(&window, handleData, sizeof(window));
    return IsWindow(window) != FALSE;
}

napi_value __cdecl beginWindowMove(napi_env env, napi_callback_info info) {
    std::size_t count = 1;
    napi_value arguments[1] = {};
    HWND window = nullptr;
    if (g_napi.getCallbackInfo(env, info, &count, arguments, nullptr, nullptr) != NAPI_OK ||
        count < 1 || !readWindowHandle(env, arguments[0], window) ||
        !GetWindowRect(window, &g_moveOrigin)) {
        g_moveWindow = nullptr;
        return createInt32Result(env, -1);
    }
    g_moveWindow = window;
    g_moveDpi = GetDpiForWindow(window);
    if (g_moveDpi == 0) {
        g_moveDpi = USER_DEFAULT_SCREEN_DPI;
    }
    return createInt32Result(env, 1);
}

napi_value __cdecl moveWindow(napi_env env, napi_callback_info info) {
    std::size_t count = 3;
    napi_value arguments[3] = {};
    if (g_napi.getCallbackInfo(env, info, &count, arguments, nullptr, nullptr) != NAPI_OK ||
        count < 3) {
        return createInt32Result(env, -1);
    }
    HWND window = nullptr;
    if (!readWindowHandle(env, arguments[0], window) || window != g_moveWindow) {
        return createInt32Result(env, -2);
    }
    std::int32_t x = 0;
    std::int32_t y = 0;
    if (g_napi.getValueInt32(env, arguments[1], &x) != NAPI_OK ||
        g_napi.getValueInt32(env, arguments[2], &y) != NAPI_OK) {
        return createInt32Result(env, -4);
    }
    const auto physicalX = g_moveOrigin.left + MulDiv(x, g_moveDpi, USER_DEFAULT_SCREEN_DPI);
    const auto physicalY = g_moveOrigin.top + MulDiv(y, g_moveDpi, USER_DEFAULT_SCREEN_DPI);
    constexpr UINT flags = SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE |
        SWP_NOOWNERZORDER;
    return createInt32Result(
        env,
        SetWindowPos(window, nullptr, physicalX, physicalY, 0, 0, flags) ? 1 : -5);
}

napi_value __cdecl endWindowMove(napi_env env, napi_callback_info) {
    g_moveWindow = nullptr;
    g_moveOrigin = {};
    g_moveDpi = USER_DEFAULT_SCREEN_DPI;
    return createInt32Result(env, 1);
}

} // namespace

extern "C" __declspec(dllexport) std::int32_t node_api_module_get_api_version_v1() {
    return 8;
}

extern "C" __declspec(dllexport) napi_value napi_register_module_v1(
    napi_env env,
    napi_value exports) {
    if (!resolveNapiApi()) {
        return exports;
    }
    napi_value function = nullptr;
    if (g_napi.createFunction(env, "install", 7, install, nullptr, &function) == NAPI_OK) {
        g_napi.setNamedProperty(env, exports, "install", function);
    }
    function = nullptr;
    if (g_napi.createFunction(
        env,
        "armConversion",
        13,
        armConversion,
        nullptr,
        &function) == NAPI_OK) {
        g_napi.setNamedProperty(env, exports, "armConversion", function);
    }
    function = nullptr;
    if (g_napi.createFunction(
        env,
        "disarmConversion",
        16,
        disarmConversion,
        nullptr,
        &function) == NAPI_OK) {
        g_napi.setNamedProperty(env, exports, "disarmConversion", function);
    }
    function = nullptr;
    if (g_napi.createFunction(
        env,
        "beginWindowMove",
        15,
        beginWindowMove,
        nullptr,
        &function) == NAPI_OK) {
        g_napi.setNamedProperty(env, exports, "beginWindowMove", function);
    }
    function = nullptr;
    if (g_napi.createFunction(
        env,
        "moveWindow",
        10,
        moveWindow,
        nullptr,
        &function) == NAPI_OK) {
        g_napi.setNamedProperty(env, exports, "moveWindow", function);
    }
    function = nullptr;
    if (g_napi.createFunction(
        env,
        "endWindowMove",
        13,
        endWindowMove,
        nullptr,
        &function) == NAPI_OK) {
        g_napi.setNamedProperty(env, exports, "endWindowMove", function);
    }
    return exports;
}
